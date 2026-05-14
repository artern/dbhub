import { beforeEach, describe, expect, it, vi } from "vitest";

const { createPoolMock, outFormatObject } = vi.hoisted(() => ({
  createPoolMock: vi.fn(),
  outFormatObject: 4002,
}));

vi.mock("dmdb", () => ({
  default: {
    createPool: createPoolMock,
    OUT_FORMAT_OBJECT: outFormatObject,
  },
}));

import { DMDBConnector } from "../dmdb/index.js";

describe("DMDBConnector", () => {
  beforeEach(() => {
    createPoolMock.mockReset();
  });

  it("should create pools with a dm:// connectString for the driver", async () => {
    const connection = {
      execute: vi.fn().mockResolvedValue({
        rows: [{ CURRENT_SCHEMA: "APP" }],
      }),
      ping: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const pool = {
      getConnection: vi.fn().mockResolvedValue(connection),
      close: vi.fn().mockResolvedValue(undefined),
    };

    createPoolMock.mockResolvedValue(pool);

    const connector = new DMDBConnector();
    await connector.connect(
      "dmdb://SYSDBA:secret@localhost:5237/APP?rwSeparate=true",
      undefined,
      {
        connectionTimeoutSeconds: 10,
        queryTimeoutSeconds: 30,
      }
    );

    expect(createPoolMock).toHaveBeenCalledWith({
      connectString:
        "dm://SYSDBA:secret@localhost:5237?rwSeparate=true&schema=APP&connectTimeout=10000&socketTimeout=30000",
      poolMin: 0,
      poolMax: 4,
    });
  });
});
