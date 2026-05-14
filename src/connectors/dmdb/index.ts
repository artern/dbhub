import dmdb from "dmdb";
import {
  Connector,
  ConnectorConfig,
  ConnectorRegistry,
  ConnectorType,
  DSNParser,
  ExecuteOptions,
  SQLResult,
  StoredProcedure,
  TableColumn,
  TableIndex,
} from "../interface.js";
import { SafeURL } from "../../utils/safe-url.js";
import { obfuscateDSNPassword } from "../../utils/dsn-obfuscate.js";
import { SQLRowLimiter } from "../../utils/sql-row-limiter.js";
import { splitSQLStatements } from "../../utils/sql-parser.js";

function parseDmQueryParamValue(value: string): string | number | boolean {
  const normalized = value.trim();
  if (/^(true|false)$/i.test(normalized)) {
    return normalized.toLowerCase() === "true";
  }
  if (/^-?\d+$/.test(normalized)) {
    return Number(normalized);
  }
  return value;
}

class DMDBDSNParser implements DSNParser {
  async parse(dsn: string, config?: ConnectorConfig): Promise<dmdb.ConnectionAttributes> {
    const connectionTimeoutSeconds = config?.connectionTimeoutSeconds;
    const queryTimeoutSeconds = config?.queryTimeoutSeconds;

    if (!this.isValidDSN(dsn)) {
      const obfuscatedDSN = obfuscateDSNPassword(dsn);
      const expectedFormat = this.getSampleDSN();
      throw new Error(
        `Invalid DMDB DSN format.\nProvided: ${obfuscatedDSN}\nExpected: ${expectedFormat}`
      );
    }

    try {
      const url = new SafeURL(dsn);
      const port = url.port ? parseInt(url.port, 10) : 5236;
      const schemaFromPath = url.pathname ? url.pathname.substring(1) : "";
      const schema = url.getSearchParam("schema") || schemaFromPath || undefined;

      const attributes: dmdb.ConnectionAttributes = {
        connectString: `${url.hostname}:${port}`,
        user: url.username,
        password: url.password,
      };

      if (schema) {
        attributes.schema = decodeURIComponent(schema);
      }

      if (connectionTimeoutSeconds !== undefined) {
        attributes.connectTimeout = connectionTimeoutSeconds * 1000;
      }

      if (queryTimeoutSeconds !== undefined) {
        attributes.socketTimeout = queryTimeoutSeconds * 1000;
      }

      url.forEachSearchParam((value, key) => {
        if (key === "schema") {
          return;
        }
        attributes[key] = parseDmQueryParamValue(value);
      });

      return attributes;
    } catch (error) {
      throw new Error(
        `Failed to parse DMDB DSN: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  getSampleDSN(): string {
    return "dm://SYSDBA:SYSDBA@localhost:5236/SYSDBA";
  }

  isValidDSN(dsn: string): boolean {
    try {
      return dsn.startsWith("dm://") || dsn.startsWith("dmdb://");
    } catch {
      return false;
    }
  }
}

export class DMDBConnector implements Connector {
  id: ConnectorType = "dmdb";
  name = "DMDB";
  dsnParser = new DMDBDSNParser();

  private pool: dmdb.Pool | null = null;
  private defaultSchema = "SYSDBA";
  private sourceId = "default";

  getId(): string {
    return this.sourceId;
  }

  clone(): Connector {
    return new DMDBConnector();
  }

  async connect(dsn: string, initScript?: string, config?: ConnectorConfig): Promise<void> {
    const attributes = await this.dsnParser.parse(dsn, config);
    this.pool = await dmdb.createPool({
      ...attributes,
      poolMin: 0,
      poolMax: 4,
    });

    await this.withConnection(async (connection) => {
      this.defaultSchema = await this.resolveCurrentSchema(connection, attributes);

      if (initScript) {
        const statements = splitSQLStatements(initScript, "dmdb");
        for (const statement of statements) {
          await connection.execute(statement);
        }
      }

      await connection.ping();
    });
  }

  async disconnect(): Promise<void> {
    if (this.pool) {
      await this.pool.close();
      this.pool = null;
    }
  }

  async getSchemas(): Promise<string[]> {
    const result = await this.query<{ SCHEMA_NAME: string }>(
      `
        SELECT USERNAME AS SCHEMA_NAME
        FROM ALL_USERS
        ORDER BY USERNAME
      `
    );

    return result.rows.map((row) => row.SCHEMA_NAME);
  }

  async getTables(schema?: string): Promise<string[]> {
    const schemaToUse = this.getSchemaToUse(schema);
    const result = await this.query<{ TABLE_NAME: string }>(
      `
        SELECT TABLE_NAME
        FROM ALL_TABLES
        WHERE OWNER = :1
        ORDER BY TABLE_NAME
      `,
      [schemaToUse]
    );

    return result.rows.map((row) => row.TABLE_NAME);
  }

  async tableExists(tableName: string, schema?: string): Promise<boolean> {
    const schemaToUse = this.getSchemaToUse(schema);
    const result = await this.query<{ COUNT: number }>(
      `
        SELECT COUNT(*) AS COUNT
        FROM ALL_TABLES
        WHERE OWNER = :1
          AND TABLE_NAME = :2
      `,
      [schemaToUse, tableName]
    );

    return Number(result.rows[0]?.COUNT || 0) > 0;
  }

  async getTableSchema(tableName: string, schema?: string): Promise<TableColumn[]> {
    const schemaToUse = this.getSchemaToUse(schema);
    const result = await this.query<{
      COLUMN_NAME: string;
      DATA_TYPE: string;
      IS_NULLABLE: string;
      COLUMN_DEFAULT: string | null;
      DESCRIPTION: string | null;
    }>(
      `
        SELECT
          c.COLUMN_NAME,
          c.DATA_TYPE,
          CASE WHEN c.NULLABLE = 'Y' THEN 'YES' ELSE 'NO' END AS IS_NULLABLE,
          c.DATA_DEFAULT AS COLUMN_DEFAULT,
          cc.COMMENTS AS DESCRIPTION
        FROM ALL_TAB_COLUMNS c
        LEFT JOIN ALL_COL_COMMENTS cc
          ON cc.OWNER = c.OWNER
         AND cc.TABLE_NAME = c.TABLE_NAME
         AND cc.COLUMN_NAME = c.COLUMN_NAME
        WHERE c.OWNER = :1
          AND c.TABLE_NAME = :2
        ORDER BY c.COLUMN_ID
      `,
      [schemaToUse, tableName]
    );

    return result.rows.map((row) => ({
      column_name: row.COLUMN_NAME,
      data_type: row.DATA_TYPE,
      is_nullable: row.IS_NULLABLE,
      column_default: row.COLUMN_DEFAULT,
      description: row.DESCRIPTION || null,
    }));
  }

  async getTableIndexes(tableName: string, schema?: string): Promise<TableIndex[]> {
    const schemaToUse = this.getSchemaToUse(schema);
    const result = await this.query<{
      INDEX_NAME: string;
      COLUMN_NAME: string;
      IS_UNIQUE: number;
      IS_PRIMARY: number;
    }>(
      `
        SELECT
          i.INDEX_NAME,
          ic.COLUMN_NAME,
          CASE WHEN i.UNIQUENESS = 'UNIQUE' THEN 1 ELSE 0 END AS IS_UNIQUE,
          CASE WHEN cons.CONSTRAINT_TYPE = 'P' THEN 1 ELSE 0 END AS IS_PRIMARY
        FROM ALL_INDEXES i
        JOIN ALL_IND_COLUMNS ic
          ON ic.INDEX_OWNER = i.OWNER
         AND ic.INDEX_NAME = i.INDEX_NAME
        LEFT JOIN ALL_CONSTRAINTS cons
          ON cons.OWNER = i.OWNER
         AND cons.TABLE_NAME = i.TABLE_NAME
         AND cons.INDEX_NAME = i.INDEX_NAME
         AND cons.CONSTRAINT_TYPE = 'P'
        WHERE i.OWNER = :1
          AND i.TABLE_NAME = :2
        ORDER BY i.INDEX_NAME, ic.COLUMN_POSITION
      `,
      [schemaToUse, tableName]
    );

    const indexMap = new Map<string, TableIndex>();
    for (const row of result.rows) {
      const existing = indexMap.get(row.INDEX_NAME);
      if (existing) {
        existing.column_names.push(row.COLUMN_NAME);
        continue;
      }

      indexMap.set(row.INDEX_NAME, {
        index_name: row.INDEX_NAME,
        column_names: [row.COLUMN_NAME],
        is_unique: Number(row.IS_UNIQUE) === 1,
        is_primary: Number(row.IS_PRIMARY) === 1,
      });
    }

    return Array.from(indexMap.values());
  }

  async getStoredProcedures(schema?: string, routineType?: "procedure" | "function"): Promise<string[]> {
    const schemaToUse = this.getSchemaToUse(schema);
    const objectType =
      routineType === "procedure"
        ? "PROCEDURE"
        : routineType === "function"
          ? "FUNCTION"
          : null;

    const binds = objectType ? [schemaToUse, objectType] : [schemaToUse];
    const filter = objectType ? "AND OBJECT_TYPE = :2" : "AND OBJECT_TYPE IN ('PROCEDURE', 'FUNCTION')";

    const result = await this.query<{ OBJECT_NAME: string }>(
      `
        SELECT OBJECT_NAME
        FROM ALL_OBJECTS
        WHERE OWNER = :1
          ${filter}
        ORDER BY OBJECT_NAME
      `,
      binds
    );

    return result.rows.map((row) => row.OBJECT_NAME);
  }

  async getStoredProcedureDetail(procedureName: string, schema?: string): Promise<StoredProcedure> {
    const schemaToUse = this.getSchemaToUse(schema);
    const detailResult = await this.query<{
      PROCEDURE_NAME: string;
      PROCEDURE_TYPE: string;
    }>(
      `
        SELECT
          OBJECT_NAME AS PROCEDURE_NAME,
          OBJECT_TYPE AS PROCEDURE_TYPE
        FROM ALL_OBJECTS
        WHERE OWNER = :1
          AND OBJECT_NAME = :2
          AND OBJECT_TYPE IN ('PROCEDURE', 'FUNCTION')
      `,
      [schemaToUse, procedureName]
    );

    const routine = detailResult.rows[0];
    if (!routine) {
      throw new Error(`Stored procedure '${procedureName}' not found in schema '${schemaToUse}'`);
    }

    const argumentResult = await this.query<{
      POSITION: number;
      ARGUMENT_NAME: string | null;
      IN_OUT: string | null;
      DATA_TYPE: string | null;
    }>(
      `
        SELECT POSITION, ARGUMENT_NAME, IN_OUT, DATA_TYPE
        FROM ALL_ARGUMENTS
        WHERE OWNER = :1
          AND OBJECT_NAME = :2
          AND PACKAGE_NAME IS NULL
        ORDER BY POSITION, SEQUENCE
      `,
      [schemaToUse, procedureName]
    );

    const returnRow = argumentResult.rows.find((row) => Number(row.POSITION) === 0);
    const parameterList = argumentResult.rows
      .filter((row) => Number(row.POSITION) > 0)
      .map((row) => {
        const name = row.ARGUMENT_NAME || `ARG${row.POSITION}`;
        const mode = row.IN_OUT || "IN";
        const dataType = row.DATA_TYPE || "UNKNOWN";
        return `${name} ${mode} ${dataType}`;
      })
      .join(", ");

    const sourceResult = await this.query<{ TEXT: string }>(
      `
        SELECT TEXT
        FROM ALL_SOURCE
        WHERE OWNER = :1
          AND NAME = :2
          AND TYPE = :3
        ORDER BY LINE
      `,
      [schemaToUse, procedureName, routine.PROCEDURE_TYPE]
    );

    const definition = sourceResult.rows.length > 0
      ? sourceResult.rows.map((row) => row.TEXT).join("").trim()
      : undefined;

    return {
      procedure_name: routine.PROCEDURE_NAME,
      procedure_type: routine.PROCEDURE_TYPE === "FUNCTION" ? "function" : "procedure",
      language: "sql",
      parameter_list: parameterList,
      return_type: routine.PROCEDURE_TYPE === "FUNCTION" ? returnRow?.DATA_TYPE || undefined : undefined,
      definition,
    };
  }

  async getTableRowCount(tableName: string, schema?: string): Promise<number | null> {
    const schemaToUse = this.getSchemaToUse(schema);
    const result = await this.query<{ NUM_ROWS: number | null }>(
      `
        SELECT NUM_ROWS
        FROM ALL_TABLES
        WHERE OWNER = :1
          AND TABLE_NAME = :2
      `,
      [schemaToUse, tableName]
    );

    const value = result.rows[0]?.NUM_ROWS;
    return value === null || value === undefined ? null : Number(value);
  }

  async getTableComment(tableName: string, schema?: string): Promise<string | null> {
    const schemaToUse = this.getSchemaToUse(schema);
    const result = await this.query<{ COMMENTS: string | null }>(
      `
        SELECT COMMENTS
        FROM ALL_TAB_COMMENTS
        WHERE OWNER = :1
          AND TABLE_NAME = :2
      `,
      [schemaToUse, tableName]
    );

    return result.rows[0]?.COMMENTS || null;
  }

  async executeSQL(sql: string, options: ExecuteOptions, parameters?: any[]): Promise<SQLResult> {
    return this.withConnection(async (connection) => {
      const statements = splitSQLStatements(sql, "dmdb");
      if (parameters && parameters.length > 0 && statements.length > 1) {
        throw new Error("DMDB connector does not support parameters with multi-statement SQL");
      }

      let finalRows: any[] = [];
      let finalRowCount = 0;

      for (const [index, statement] of statements.entries()) {
        const processedStatement = SQLRowLimiter.applyMaxRows(statement, options.maxRows);
        const bindParams = index === 0 ? parameters : undefined;
        const result = await connection.execute<any>(
          processedStatement,
          bindParams || [],
          {
            maxRows: options.maxRows,
            outFormat: dmdb.OUT_FORMAT_OBJECT,
            resultSet: false,
          }
        );

        finalRows = result.rows || [];
        finalRowCount = result.rowsAffected !== undefined
          ? Number(result.rowsAffected)
          : finalRows.length;
      }

      return {
        rows: finalRows,
        rowCount: finalRowCount,
      };
    });
  }

  private getSchemaToUse(schema?: string): string {
    return schema || this.defaultSchema;
  }

  private async resolveCurrentSchema(
    connection: dmdb.Connection,
    attributes: dmdb.ConnectionAttributes
  ): Promise<string> {
    if (attributes.schema && typeof attributes.schema === "string") {
      return attributes.schema;
    }

    try {
      const result = await connection.execute<{ CURRENT_SCHEMA: string }>(
        "SELECT USER AS CURRENT_SCHEMA FROM DUAL",
        [],
        {
          outFormat: dmdb.OUT_FORMAT_OBJECT,
          resultSet: false,
        }
      );
      return result.rows?.[0]?.CURRENT_SCHEMA || attributes.user || this.defaultSchema;
    } catch {
      return attributes.user || this.defaultSchema;
    }
  }

  private async withConnection<T>(fn: (connection: dmdb.Connection) => Promise<T>): Promise<T> {
    if (!this.pool) {
      throw new Error("Not connected to DMDB database");
    }

    const connection = await this.pool.getConnection();
    try {
      return await fn(connection);
    } finally {
      await connection.close();
    }
  }

  private async query<T extends Record<string, any>>(sql: string, bindParams: any[] = []): Promise<SQLResult & { rows: T[] }> {
    return this.withConnection(async (connection) => {
      const result = await connection.execute<T>(sql, bindParams, {
        outFormat: dmdb.OUT_FORMAT_OBJECT,
        resultSet: false,
      });

      return {
        rows: (result.rows || []) as T[],
        rowCount: result.rowsAffected !== undefined
          ? Number(result.rowsAffected)
          : (result.rows || []).length,
      };
    });
  }
}

const dmdbConnector = new DMDBConnector();
ConnectorRegistry.register(dmdbConnector);
