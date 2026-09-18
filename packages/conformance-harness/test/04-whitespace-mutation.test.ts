import { describe, expect, test } from "vitest";
import { validIntent } from "../src/lib/fixtures.js";
import { sut, sealWith, contentHashOf } from "../src/sut.js";

const { canonicalize } = sut.canonical;
const { IntentContractSchema } = sut.objects;
const contentHash = contentHashOf;

/** AREA 4 — Whitespace mutation: irrelevant outside strings, significant inside them. */
describe("[C-04] whitespace mutation", () => {
  const intent = validIntent();
  const compact = JSON.stringify(intent);

  const variants: Array<[string, string]> = [
    ["pretty-2", JSON.stringify(intent, null, 2)],
    ["pretty-4", JSON.stringify(intent, null, 4)],
    ["tabs", JSON.stringify(intent, null, "\t")],
    ["crlf-lines", JSON.stringify(intent, null, 2).replace(/\n/g, "\r\n")],
    ["trailing-newline", compact + "\n"],
    ["leading-space", "  " + compact],
    ["repretty", JSON.stringify(JSON.parse(JSON.stringify(intent, null, 2)), null, "\t")],
  ];

  test.each(variants)("[C-04-01] whitespace variant '%s' yields identical content_hash", (_name, text) => {
    const sealed = sealWith(IntentContractSchema, JSON.parse(text));
    expect(contentHash(sealed)).toBe(contentHash(sealWith(IntentContractSchema, JSON.parse(compact))));
  });

  test("[C-04-02] whitespace INSIDE string values is significant and changes the hash", () => {
    const a = canonicalize({ s: "a b" });
    expect(canonicalize({ s: "a  b" })).not.toBe(a);
    expect(canonicalize({ s: "a\tb" })).not.toBe(a);
    expect(canonicalize({ s: "a\nb" })).not.toBe(a);
    expect(canonicalize({ s: "a b" })).toBe(a); // control: identical
  });

  test("[C-04-03] canonical output itself contains no non-string whitespace", () => {
    const c = canonicalize(intent);
    // outside of string literals, JSON structural whitespace would appear as ", " or ": "
    expect(c).not.toMatch(/", |": "|\[ |\] |\{ |\} /);
    expect(c).toBe(c.replace(/[ \t\r\n]+(?=[\{\}\[\],:])/g, "")); // none before structural chars
  });

  test("[C-04-04] tab/newline inside string survives into canonical as \\u0009 / \\u000a escapes", () => {
    expect(canonicalize({ s: "a\tb" })).toBe("{\"s\":\"a\\tb\"}");
    expect(canonicalize({ s: "a\nb" })).toBe("{\"s\":\"a\\nb\"}");
  });
});
