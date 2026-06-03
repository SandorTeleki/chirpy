import { describe, it, expect, beforeAll } from "vitest";
import { makeJWT, validateJWT, hashPassword, checkPasswordHash } from "./auth.js";

const secret = "test-secret";

describe("JWT", () => {
  it("should create and validate a JWT", () => {
    const userID = "123e4567-e89b-12d3-a456-426614174000";
    const token = makeJWT(userID, 3600, secret);
    const result = validateJWT(token, secret);
    expect(result).toBe(userID);
  });

  it("should reject an expired token", () => {
    const userID = "123e4567-e89b-12d3-a456-426614174000";
    const token = makeJWT(userID, -1, secret);
    expect(() => validateJWT(token, secret)).toThrow();
  });

  it("should reject a token signed with the wrong secret", () => {
    const userID = "123e4567-e89b-12d3-a456-426614174000";
    const token = makeJWT(userID, 3600, secret);
    expect(() => validateJWT(token, "wrong-secret")).toThrow();
  });
});

describe("Password Hashing", () => {
  const password1 = "correctPassword123!";
  const password2 = "anotherPassword456!";
  let hash1: string;
  let hash2: string;

  beforeAll(async () => {
    hash1 = await hashPassword(password1);
    hash2 = await hashPassword(password2);
  });

  it("should return true for the correct password", async () => {
    const result = await checkPasswordHash(password1, hash1);
    expect(result).toBe(true);
  });

  it("should return false for the wrong password", async () => {
    const result = await checkPasswordHash("wrongPassword", hash1);
    expect(result).toBe(false);
  });

  it("should produce different hashes for different passwords", () => {
    expect(hash1).not.toBe(hash2);
  });
});
