import { describe, it, expect } from "vitest";
import { buildParams } from "./params.js";

describe("buildParams", () => {
  it("preserves the numeric value 0 (regression for #32 thumb_offset bug class)", () => {
    expect(buildParams({}, { thumb_offset: 0 })).toEqual({ thumb_offset: 0 });
  });

  it("preserves the boolean value false", () => {
    expect(buildParams({}, { share_to_feed: false })).toEqual({ share_to_feed: false });
  });

  it("preserves the empty string \"\"", () => {
    expect(buildParams({}, { caption: "" })).toEqual({ caption: "" });
  });

  it("preserves null", () => {
    expect(buildParams({}, { value: null })).toEqual({ value: null });
  });

  it("skips only undefined", () => {
    expect(buildParams({}, { a: undefined })).toEqual({});
  });

  it("merges required and optional fields", () => {
    expect(buildParams({ a: 1 }, { b: 2 })).toEqual({ a: 1, b: 2 });
  });

  it("returns required unchanged when optional is empty", () => {
    expect(buildParams({ a: 1, b: 2 }, {})).toEqual({ a: 1, b: 2 });
  });

  it("returns an empty object when both arguments are empty", () => {
    expect(buildParams({}, {})).toEqual({});
  });

  it("lets optional override required when keys collide", () => {
    expect(buildParams({ media_type: "TEXT" }, { media_type: "IMAGE" })).toEqual({ media_type: "IMAGE" });
  });

  it("does not let an optional undefined erase a required value", () => {
    expect(buildParams({ media_type: "TEXT" }, { media_type: undefined })).toEqual({ media_type: "TEXT" });
  });

  it("mixes truthy and falsy optionals correctly", () => {
    const result = buildParams(
      { id: "abc" },
      { limit: 0, after: undefined, reverse: false, q: "" }
    );
    expect(result).toEqual({ id: "abc", limit: 0, reverse: false, q: "" });
  });

  it("does not mutate the required argument", () => {
    const required = { a: 1 };
    buildParams(required, { b: 2 });
    expect(required).toEqual({ a: 1 });
  });

  it("does not mutate the optional argument", () => {
    const optional = { a: 1, b: undefined };
    buildParams({}, optional);
    expect(optional).toEqual({ a: 1, b: undefined });
  });

  it("preserves key insertion order: required first, then optional", () => {
    const result = buildParams({ a: 1, b: 2 }, { c: 3, d: 4 });
    expect(Object.keys(result)).toEqual(["a", "b", "c", "d"]);
  });

  it("places an overriding optional key in the original (required) position", () => {
    const result = buildParams({ a: 1, b: 2 }, { a: 99, c: 3 });
    expect(Object.keys(result)).toEqual(["a", "b", "c"]);
    expect(result).toEqual({ a: 99, b: 2, c: 3 });
  });
});
