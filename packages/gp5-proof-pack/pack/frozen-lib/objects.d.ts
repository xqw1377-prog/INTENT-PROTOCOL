/**
 * S0 canonical schemas (Appendix A of the Technical Architecture, V0.1 draft).
 *
 * Scope: IntentContractV1, CriterionV1, MilestoneV1, EvidenceArtifactV1,
 * EvidenceBundleV1, VerificationDecisionV1, OutcomeReceiptV1,
 * SettlementInstructionV1 — the eight G1 trust primitives (docs/TRUST-CHAIN.md)
 * plus the shared sub-schemas they reference. `schema_version` literals are
 * frozen per object.
 *
 * Hashing convention:
 *   content_hash = hashObject(Domain.X, schema_version, object minus { content_hash, signature })
 * Signatures sign the content_hash, not the raw bytes.
 */
import { z } from "zod";
import { type Hash } from "./hash.js";
/**
 * Exact decimal addition over canonical decimal strings — BigInt scaled
 * arithmetic, never floats (Commander ruling: settlement math must be exact).
 * Inputs must already satisfy DecimalSchema.
 */
export declare function decimalSum(amounts: readonly string[]): string;
/** Fractional-digit count of a canonical decimal ("0.01" → 2, "10" → 0). */
export declare function decimalScale(a: string): number;
/** Exact comparison of two canonical decimals via scaled BigInt (no floats). Returns -1 | 0 | 1. */
export declare function decimalCompare(a: string, b: string): number;
export declare const EvidenceRuleSchema: z.ZodObject<{
    kind: z.ZodString;
    min_level: z.ZodEnum<["E0", "E1", "E2", "E3"]>;
    source: z.ZodString;
    required: z.ZodBoolean;
}, "strict", z.ZodTypeAny, {
    kind: string;
    min_level: "E0" | "E1" | "E2" | "E3";
    source: string;
    required: boolean;
}, {
    kind: string;
    min_level: "E0" | "E1" | "E2" | "E3";
    source: string;
    required: boolean;
}>;
export type EvidenceRule = z.infer<typeof EvidenceRuleSchema>;
export declare const CriterionSchema: z.ZodObject<{
    schema_version: z.ZodLiteral<"criterion.v1">;
    criterion_id: z.ZodString;
    kind: z.ZodEnum<["MACHINE", "ECONOMIC", "CRYPTO", "HUMAN"]>;
    assertion: z.ZodString;
    verifier_ref: z.ZodString;
    evidence_requirements: z.ZodArray<z.ZodObject<{
        kind: z.ZodString;
        min_level: z.ZodEnum<["E0", "E1", "E2", "E3"]>;
        source: z.ZodString;
        required: z.ZodBoolean;
    }, "strict", z.ZodTypeAny, {
        kind: string;
        min_level: "E0" | "E1" | "E2" | "E3";
        source: string;
        required: boolean;
    }, {
        kind: string;
        min_level: "E0" | "E1" | "E2" | "E3";
        source: string;
        required: boolean;
    }>, "many">;
    threshold: z.ZodType<unknown, z.ZodTypeDef, unknown>;
}, "strict", z.ZodTypeAny, {
    kind: "MACHINE" | "ECONOMIC" | "CRYPTO" | "HUMAN";
    schema_version: "criterion.v1";
    criterion_id: string;
    assertion: string;
    verifier_ref: string;
    evidence_requirements: {
        kind: string;
        min_level: "E0" | "E1" | "E2" | "E3";
        source: string;
        required: boolean;
    }[];
    threshold?: unknown;
}, {
    kind: "MACHINE" | "ECONOMIC" | "CRYPTO" | "HUMAN";
    schema_version: "criterion.v1";
    criterion_id: string;
    assertion: string;
    verifier_ref: string;
    evidence_requirements: {
        kind: string;
        min_level: "E0" | "E1" | "E2" | "E3";
        source: string;
        required: boolean;
    }[];
    threshold?: unknown;
}>;
export type Criterion = z.infer<typeof CriterionSchema>;
export declare const GoalSpecSchema: z.ZodObject<{
    statement: z.ZodString;
    /** Desired end-state as the owner phrased it; Goal != Task (WP §4.2). */
    target_state: z.ZodString;
    domain: z.ZodString;
}, "strict", z.ZodTypeAny, {
    statement: string;
    target_state: string;
    domain: string;
}, {
    statement: string;
    target_state: string;
    domain: string;
}>;
export declare const ConstraintSchema: z.ZodObject<{
    constraint_id: z.ZodString;
    kind: z.ZodEnum<["FORBIDDEN_ACTION", "SCOPE", "COMPLIANCE", "BUDGET", "TIME", "OTHER"]>;
    statement: z.ZodString;
    max_risk_level: z.ZodOptional<z.ZodEnum<["L0", "L1", "L2", "L3"]>>;
}, "strict", z.ZodTypeAny, {
    kind: "FORBIDDEN_ACTION" | "SCOPE" | "COMPLIANCE" | "BUDGET" | "TIME" | "OTHER";
    statement: string;
    constraint_id: string;
    max_risk_level?: "L0" | "L1" | "L2" | "L3" | undefined;
}, {
    kind: "FORBIDDEN_ACTION" | "SCOPE" | "COMPLIANCE" | "BUDGET" | "TIME" | "OTHER";
    statement: string;
    constraint_id: string;
    max_risk_level?: "L0" | "L1" | "L2" | "L3" | undefined;
}>;
export declare const BudgetSpecSchema: z.ZodEffects<z.ZodObject<{
    asset: z.ZodObject<{
        network: z.ZodString;
        asset: z.ZodString;
        decimals: z.ZodNumber;
    }, "strict", z.ZodTypeAny, {
        network: string;
        asset: string;
        decimals: number;
    }, {
        network: string;
        asset: string;
        decimals: number;
    }>;
    total: z.ZodString;
    /** Hard cap for model/tool/API spend inside the total. */
    execution_cap: z.ZodString;
}, "strict", z.ZodTypeAny, {
    asset: {
        network: string;
        asset: string;
        decimals: number;
    };
    total: string;
    execution_cap: string;
}, {
    asset: {
        network: string;
        asset: string;
        decimals: number;
    };
    total: string;
    execution_cap: string;
}>, {
    asset: {
        network: string;
        asset: string;
        decimals: number;
    };
    total: string;
    execution_cap: string;
}, {
    asset: {
        network: string;
        asset: string;
        decimals: number;
    };
    total: string;
    execution_cap: string;
}>;
export declare const IntentContractSchema: z.ZodEffects<z.ZodObject<{
    schema_version: z.ZodLiteral<"intent.v1">;
    intent_id: z.ZodString;
    version: z.ZodNumber;
    owner_subject: z.ZodString;
    goal: z.ZodObject<{
        statement: z.ZodString;
        /** Desired end-state as the owner phrased it; Goal != Task (WP §4.2). */
        target_state: z.ZodString;
        domain: z.ZodString;
    }, "strict", z.ZodTypeAny, {
        statement: string;
        target_state: string;
        domain: string;
    }, {
        statement: string;
        target_state: string;
        domain: string;
    }>;
    success_criteria: z.ZodArray<z.ZodObject<{
        schema_version: z.ZodLiteral<"criterion.v1">;
        criterion_id: z.ZodString;
        kind: z.ZodEnum<["MACHINE", "ECONOMIC", "CRYPTO", "HUMAN"]>;
        assertion: z.ZodString;
        verifier_ref: z.ZodString;
        evidence_requirements: z.ZodArray<z.ZodObject<{
            kind: z.ZodString;
            min_level: z.ZodEnum<["E0", "E1", "E2", "E3"]>;
            source: z.ZodString;
            required: z.ZodBoolean;
        }, "strict", z.ZodTypeAny, {
            kind: string;
            min_level: "E0" | "E1" | "E2" | "E3";
            source: string;
            required: boolean;
        }, {
            kind: string;
            min_level: "E0" | "E1" | "E2" | "E3";
            source: string;
            required: boolean;
        }>, "many">;
        threshold: z.ZodType<unknown, z.ZodTypeDef, unknown>;
    }, "strict", z.ZodTypeAny, {
        kind: "MACHINE" | "ECONOMIC" | "CRYPTO" | "HUMAN";
        schema_version: "criterion.v1";
        criterion_id: string;
        assertion: string;
        verifier_ref: string;
        evidence_requirements: {
            kind: string;
            min_level: "E0" | "E1" | "E2" | "E3";
            source: string;
            required: boolean;
        }[];
        threshold?: unknown;
    }, {
        kind: "MACHINE" | "ECONOMIC" | "CRYPTO" | "HUMAN";
        schema_version: "criterion.v1";
        criterion_id: string;
        assertion: string;
        verifier_ref: string;
        evidence_requirements: {
            kind: string;
            min_level: "E0" | "E1" | "E2" | "E3";
            source: string;
            required: boolean;
        }[];
        threshold?: unknown;
    }>, "many">;
    constraints: z.ZodArray<z.ZodObject<{
        constraint_id: z.ZodString;
        kind: z.ZodEnum<["FORBIDDEN_ACTION", "SCOPE", "COMPLIANCE", "BUDGET", "TIME", "OTHER"]>;
        statement: z.ZodString;
        max_risk_level: z.ZodOptional<z.ZodEnum<["L0", "L1", "L2", "L3"]>>;
    }, "strict", z.ZodTypeAny, {
        kind: "FORBIDDEN_ACTION" | "SCOPE" | "COMPLIANCE" | "BUDGET" | "TIME" | "OTHER";
        statement: string;
        constraint_id: string;
        max_risk_level?: "L0" | "L1" | "L2" | "L3" | undefined;
    }, {
        kind: "FORBIDDEN_ACTION" | "SCOPE" | "COMPLIANCE" | "BUDGET" | "TIME" | "OTHER";
        statement: string;
        constraint_id: string;
        max_risk_level?: "L0" | "L1" | "L2" | "L3" | undefined;
    }>, "many">;
    budget: z.ZodEffects<z.ZodObject<{
        asset: z.ZodObject<{
            network: z.ZodString;
            asset: z.ZodString;
            decimals: z.ZodNumber;
        }, "strict", z.ZodTypeAny, {
            network: string;
            asset: string;
            decimals: number;
        }, {
            network: string;
            asset: string;
            decimals: number;
        }>;
        total: z.ZodString;
        /** Hard cap for model/tool/API spend inside the total. */
        execution_cap: z.ZodString;
    }, "strict", z.ZodTypeAny, {
        asset: {
            network: string;
            asset: string;
            decimals: number;
        };
        total: string;
        execution_cap: string;
    }, {
        asset: {
            network: string;
            asset: string;
            decimals: number;
        };
        total: string;
        execution_cap: string;
    }>, {
        asset: {
            network: string;
            asset: string;
            decimals: number;
        };
        total: string;
        execution_cap: string;
    }, {
        asset: {
            network: string;
            asset: string;
            decimals: number;
        };
        total: string;
        execution_cap: string;
    }>;
    deadline: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
    verification_policy_ref: z.ZodObject<{
        uri: z.ZodString;
        hash: z.ZodEffects<z.ZodString, `sha256:${string}`, string>;
    }, "strict", z.ZodTypeAny, {
        uri: string;
        hash: `sha256:${string}`;
    }, {
        uri: string;
        hash: string;
    }>;
    settlement_policy_ref: z.ZodObject<{
        uri: z.ZodString;
        hash: z.ZodEffects<z.ZodString, `sha256:${string}`, string>;
    }, "strict", z.ZodTypeAny, {
        uri: string;
        hash: `sha256:${string}`;
    }, {
        uri: string;
        hash: string;
    }>;
    parent_hash: z.ZodOptional<z.ZodEffects<z.ZodString, `sha256:${string}`, string>>;
    /** Required when version > 1 (AmendIntent). */
    change_reason: z.ZodOptional<z.ZodString>;
    created_at: z.ZodEffects<z.ZodString, string, string>;
    content_hash: z.ZodOptional<z.ZodEffects<z.ZodString, `sha256:${string}`, string>>;
    signature: z.ZodOptional<z.ZodObject<{
        scheme: z.ZodEnum<["ed25519", "secp256k1", "eip191", "eip712", "passkey-p256"]>;
        signer: z.ZodString;
        key_id: z.ZodString;
        value: z.ZodString;
    }, "strict", z.ZodTypeAny, {
        value: string;
        scheme: "ed25519" | "secp256k1" | "eip191" | "eip712" | "passkey-p256";
        signer: string;
        key_id: string;
    }, {
        value: string;
        scheme: "ed25519" | "secp256k1" | "eip191" | "eip712" | "passkey-p256";
        signer: string;
        key_id: string;
    }>>;
}, "strict", z.ZodTypeAny, {
    schema_version: "intent.v1";
    intent_id: string;
    version: number;
    owner_subject: string;
    goal: {
        statement: string;
        target_state: string;
        domain: string;
    };
    success_criteria: {
        kind: "MACHINE" | "ECONOMIC" | "CRYPTO" | "HUMAN";
        schema_version: "criterion.v1";
        criterion_id: string;
        assertion: string;
        verifier_ref: string;
        evidence_requirements: {
            kind: string;
            min_level: "E0" | "E1" | "E2" | "E3";
            source: string;
            required: boolean;
        }[];
        threshold?: unknown;
    }[];
    constraints: {
        kind: "FORBIDDEN_ACTION" | "SCOPE" | "COMPLIANCE" | "BUDGET" | "TIME" | "OTHER";
        statement: string;
        constraint_id: string;
        max_risk_level?: "L0" | "L1" | "L2" | "L3" | undefined;
    }[];
    budget: {
        asset: {
            network: string;
            asset: string;
            decimals: number;
        };
        total: string;
        execution_cap: string;
    };
    verification_policy_ref: {
        uri: string;
        hash: `sha256:${string}`;
    };
    settlement_policy_ref: {
        uri: string;
        hash: `sha256:${string}`;
    };
    created_at: string;
    deadline?: string | undefined;
    parent_hash?: `sha256:${string}` | undefined;
    change_reason?: string | undefined;
    content_hash?: `sha256:${string}` | undefined;
    signature?: {
        value: string;
        scheme: "ed25519" | "secp256k1" | "eip191" | "eip712" | "passkey-p256";
        signer: string;
        key_id: string;
    } | undefined;
}, {
    schema_version: "intent.v1";
    intent_id: string;
    version: number;
    owner_subject: string;
    goal: {
        statement: string;
        target_state: string;
        domain: string;
    };
    success_criteria: {
        kind: "MACHINE" | "ECONOMIC" | "CRYPTO" | "HUMAN";
        schema_version: "criterion.v1";
        criterion_id: string;
        assertion: string;
        verifier_ref: string;
        evidence_requirements: {
            kind: string;
            min_level: "E0" | "E1" | "E2" | "E3";
            source: string;
            required: boolean;
        }[];
        threshold?: unknown;
    }[];
    constraints: {
        kind: "FORBIDDEN_ACTION" | "SCOPE" | "COMPLIANCE" | "BUDGET" | "TIME" | "OTHER";
        statement: string;
        constraint_id: string;
        max_risk_level?: "L0" | "L1" | "L2" | "L3" | undefined;
    }[];
    budget: {
        asset: {
            network: string;
            asset: string;
            decimals: number;
        };
        total: string;
        execution_cap: string;
    };
    verification_policy_ref: {
        uri: string;
        hash: string;
    };
    settlement_policy_ref: {
        uri: string;
        hash: string;
    };
    created_at: string;
    deadline?: string | undefined;
    parent_hash?: string | undefined;
    change_reason?: string | undefined;
    content_hash?: string | undefined;
    signature?: {
        value: string;
        scheme: "ed25519" | "secp256k1" | "eip191" | "eip712" | "passkey-p256";
        signer: string;
        key_id: string;
    } | undefined;
}>, {
    schema_version: "intent.v1";
    intent_id: string;
    version: number;
    owner_subject: string;
    goal: {
        statement: string;
        target_state: string;
        domain: string;
    };
    success_criteria: {
        kind: "MACHINE" | "ECONOMIC" | "CRYPTO" | "HUMAN";
        schema_version: "criterion.v1";
        criterion_id: string;
        assertion: string;
        verifier_ref: string;
        evidence_requirements: {
            kind: string;
            min_level: "E0" | "E1" | "E2" | "E3";
            source: string;
            required: boolean;
        }[];
        threshold?: unknown;
    }[];
    constraints: {
        kind: "FORBIDDEN_ACTION" | "SCOPE" | "COMPLIANCE" | "BUDGET" | "TIME" | "OTHER";
        statement: string;
        constraint_id: string;
        max_risk_level?: "L0" | "L1" | "L2" | "L3" | undefined;
    }[];
    budget: {
        asset: {
            network: string;
            asset: string;
            decimals: number;
        };
        total: string;
        execution_cap: string;
    };
    verification_policy_ref: {
        uri: string;
        hash: `sha256:${string}`;
    };
    settlement_policy_ref: {
        uri: string;
        hash: `sha256:${string}`;
    };
    created_at: string;
    deadline?: string | undefined;
    parent_hash?: `sha256:${string}` | undefined;
    change_reason?: string | undefined;
    content_hash?: `sha256:${string}` | undefined;
    signature?: {
        value: string;
        scheme: "ed25519" | "secp256k1" | "eip191" | "eip712" | "passkey-p256";
        signer: string;
        key_id: string;
    } | undefined;
}, {
    schema_version: "intent.v1";
    intent_id: string;
    version: number;
    owner_subject: string;
    goal: {
        statement: string;
        target_state: string;
        domain: string;
    };
    success_criteria: {
        kind: "MACHINE" | "ECONOMIC" | "CRYPTO" | "HUMAN";
        schema_version: "criterion.v1";
        criterion_id: string;
        assertion: string;
        verifier_ref: string;
        evidence_requirements: {
            kind: string;
            min_level: "E0" | "E1" | "E2" | "E3";
            source: string;
            required: boolean;
        }[];
        threshold?: unknown;
    }[];
    constraints: {
        kind: "FORBIDDEN_ACTION" | "SCOPE" | "COMPLIANCE" | "BUDGET" | "TIME" | "OTHER";
        statement: string;
        constraint_id: string;
        max_risk_level?: "L0" | "L1" | "L2" | "L3" | undefined;
    }[];
    budget: {
        asset: {
            network: string;
            asset: string;
            decimals: number;
        };
        total: string;
        execution_cap: string;
    };
    verification_policy_ref: {
        uri: string;
        hash: string;
    };
    settlement_policy_ref: {
        uri: string;
        hash: string;
    };
    created_at: string;
    deadline?: string | undefined;
    parent_hash?: string | undefined;
    change_reason?: string | undefined;
    content_hash?: string | undefined;
    signature?: {
        value: string;
        scheme: "ed25519" | "secp256k1" | "eip191" | "eip712" | "passkey-p256";
        signer: string;
        key_id: string;
    } | undefined;
}>;
export type IntentContract = z.infer<typeof IntentContractSchema>;
export declare const EvidenceArtifactSchema: z.ZodObject<{
    schema_version: z.ZodLiteral<"artifact.v1">;
    artifact_id: z.ZodString;
    kind: z.ZodString;
    level: z.ZodEnum<["E0", "E1", "E2", "E3"]>;
    /** Who/what produced it, e.g. "github:org/repo", "ci:github-actions", "http-probe:eu-west-1". */
    source: z.ZodString;
    /** What it is about, e.g. "commit:abc123", "url:https://...". */
    subject: z.ZodString;
    captured_at: z.ZodEffects<z.ZodString, string, string>;
    /**
     * Hash of the raw artifact bytes in the CAS; never embeds RESTRICTED content.
     * Named payload_hash (not content_hash) because content_hash is the object self-digest
     * convention — see OPEN-QUESTIONS OQ-2.
     */
    payload_hash: z.ZodEffects<z.ZodString, `sha256:${string}`, string>;
    locator: z.ZodString;
    privacy_class: z.ZodEnum<["PUBLIC", "INTERNAL", "CONFIDENTIAL", "RESTRICTED"]>;
    content_hash: z.ZodOptional<z.ZodEffects<z.ZodString, `sha256:${string}`, string>>;
    signature: z.ZodOptional<z.ZodObject<{
        scheme: z.ZodEnum<["ed25519", "secp256k1", "eip191", "eip712", "passkey-p256"]>;
        signer: z.ZodString;
        key_id: z.ZodString;
        value: z.ZodString;
    }, "strict", z.ZodTypeAny, {
        value: string;
        scheme: "ed25519" | "secp256k1" | "eip191" | "eip712" | "passkey-p256";
        signer: string;
        key_id: string;
    }, {
        value: string;
        scheme: "ed25519" | "secp256k1" | "eip191" | "eip712" | "passkey-p256";
        signer: string;
        key_id: string;
    }>>;
}, "strict", z.ZodTypeAny, {
    kind: string;
    source: string;
    schema_version: "artifact.v1";
    artifact_id: string;
    level: "E0" | "E1" | "E2" | "E3";
    subject: string;
    captured_at: string;
    payload_hash: `sha256:${string}`;
    locator: string;
    privacy_class: "PUBLIC" | "INTERNAL" | "CONFIDENTIAL" | "RESTRICTED";
    content_hash?: `sha256:${string}` | undefined;
    signature?: {
        value: string;
        scheme: "ed25519" | "secp256k1" | "eip191" | "eip712" | "passkey-p256";
        signer: string;
        key_id: string;
    } | undefined;
}, {
    kind: string;
    source: string;
    schema_version: "artifact.v1";
    artifact_id: string;
    level: "E0" | "E1" | "E2" | "E3";
    subject: string;
    captured_at: string;
    payload_hash: string;
    locator: string;
    privacy_class: "PUBLIC" | "INTERNAL" | "CONFIDENTIAL" | "RESTRICTED";
    content_hash?: string | undefined;
    signature?: {
        value: string;
        scheme: "ed25519" | "secp256k1" | "eip191" | "eip712" | "passkey-p256";
        signer: string;
        key_id: string;
    } | undefined;
}>;
export type EvidenceArtifact = z.infer<typeof EvidenceArtifactSchema>;
export declare const EvidenceBundleSchema: z.ZodEffects<z.ZodObject<{
    schema_version: z.ZodLiteral<"bundle.v1">;
    bundle_id: z.ZodString;
    milestone_id: z.ZodString;
    milestone_revision: z.ZodNumber;
    run_ids: z.ZodArray<z.ZodString, "many">;
    artifact_hashes: z.ZodArray<z.ZodEffects<z.ZodString, `sha256:${string}`, string>, "many">;
    merkle_root: z.ZodOptional<z.ZodEffects<z.ZodString, `sha256:${string}`, string>>;
    submitter: z.ZodString;
    policy_hash: z.ZodEffects<z.ZodString, `sha256:${string}`, string>;
    sealed_at: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
    state: z.ZodEnum<["OPEN", "SEALED"]>;
    content_hash: z.ZodOptional<z.ZodEffects<z.ZodString, `sha256:${string}`, string>>;
    signature: z.ZodOptional<z.ZodObject<{
        scheme: z.ZodEnum<["ed25519", "secp256k1", "eip191", "eip712", "passkey-p256"]>;
        signer: z.ZodString;
        key_id: z.ZodString;
        value: z.ZodString;
    }, "strict", z.ZodTypeAny, {
        value: string;
        scheme: "ed25519" | "secp256k1" | "eip191" | "eip712" | "passkey-p256";
        signer: string;
        key_id: string;
    }, {
        value: string;
        scheme: "ed25519" | "secp256k1" | "eip191" | "eip712" | "passkey-p256";
        signer: string;
        key_id: string;
    }>>;
}, "strict", z.ZodTypeAny, {
    schema_version: "bundle.v1";
    bundle_id: string;
    milestone_id: string;
    milestone_revision: number;
    run_ids: string[];
    artifact_hashes: `sha256:${string}`[];
    submitter: string;
    policy_hash: `sha256:${string}`;
    state: "OPEN" | "SEALED";
    content_hash?: `sha256:${string}` | undefined;
    signature?: {
        value: string;
        scheme: "ed25519" | "secp256k1" | "eip191" | "eip712" | "passkey-p256";
        signer: string;
        key_id: string;
    } | undefined;
    merkle_root?: `sha256:${string}` | undefined;
    sealed_at?: string | undefined;
}, {
    schema_version: "bundle.v1";
    bundle_id: string;
    milestone_id: string;
    milestone_revision: number;
    run_ids: string[];
    artifact_hashes: string[];
    submitter: string;
    policy_hash: string;
    state: "OPEN" | "SEALED";
    content_hash?: string | undefined;
    signature?: {
        value: string;
        scheme: "ed25519" | "secp256k1" | "eip191" | "eip712" | "passkey-p256";
        signer: string;
        key_id: string;
    } | undefined;
    merkle_root?: string | undefined;
    sealed_at?: string | undefined;
}>, {
    schema_version: "bundle.v1";
    bundle_id: string;
    milestone_id: string;
    milestone_revision: number;
    run_ids: string[];
    artifact_hashes: `sha256:${string}`[];
    submitter: string;
    policy_hash: `sha256:${string}`;
    state: "OPEN" | "SEALED";
    content_hash?: `sha256:${string}` | undefined;
    signature?: {
        value: string;
        scheme: "ed25519" | "secp256k1" | "eip191" | "eip712" | "passkey-p256";
        signer: string;
        key_id: string;
    } | undefined;
    merkle_root?: `sha256:${string}` | undefined;
    sealed_at?: string | undefined;
}, {
    schema_version: "bundle.v1";
    bundle_id: string;
    milestone_id: string;
    milestone_revision: number;
    run_ids: string[];
    artifact_hashes: string[];
    submitter: string;
    policy_hash: string;
    state: "OPEN" | "SEALED";
    content_hash?: string | undefined;
    signature?: {
        value: string;
        scheme: "ed25519" | "secp256k1" | "eip191" | "eip712" | "passkey-p256";
        signer: string;
        key_id: string;
    } | undefined;
    merkle_root?: string | undefined;
    sealed_at?: string | undefined;
}>;
export type EvidenceBundle = z.infer<typeof EvidenceBundleSchema>;
export declare const MilestoneAllocationSchema: z.ZodObject<{
    asset: z.ZodObject<{
        network: z.ZodString;
        asset: z.ZodString;
        decimals: z.ZodNumber;
    }, "strict", z.ZodTypeAny, {
        network: string;
        asset: string;
        decimals: number;
    }, {
        network: string;
        asset: string;
        decimals: number;
    }>;
    amount: z.ZodString;
}, "strict", z.ZodTypeAny, {
    asset: {
        network: string;
        asset: string;
        decimals: number;
    };
    amount: string;
}, {
    asset: {
        network: string;
        asset: string;
        decimals: number;
    };
    amount: string;
}>;
export type MilestoneAllocation = z.infer<typeof MilestoneAllocationSchema>;
export declare const MilestoneSchema: z.ZodEffects<z.ZodObject<{
    schema_version: z.ZodLiteral<"milestone.v1">;
    milestone_id: z.ZodString;
    intent_hash: z.ZodEffects<z.ZodString, `sha256:${string}`, string>;
    milestone_revision: z.ZodNumber;
    /** Non-empty, unique; array order is canonical/significant. */
    criterion_ids: z.ZodArray<z.ZodString, "many">;
    verification_policy_hash: z.ZodEffects<z.ZodString, `sha256:${string}`, string>;
    settlement_policy_hash: z.ZodEffects<z.ZodString, `sha256:${string}`, string>;
    allocation: z.ZodObject<{
        asset: z.ZodObject<{
            network: z.ZodString;
            asset: z.ZodString;
            decimals: z.ZodNumber;
        }, "strict", z.ZodTypeAny, {
            network: string;
            asset: string;
            decimals: number;
        }, {
            network: string;
            asset: string;
            decimals: number;
        }>;
        amount: z.ZodString;
    }, "strict", z.ZodTypeAny, {
        asset: {
            network: string;
            asset: string;
            decimals: number;
        };
        amount: string;
    }, {
        asset: {
            network: string;
            asset: string;
            decimals: number;
        };
        amount: string;
    }>;
    content_hash: z.ZodOptional<z.ZodEffects<z.ZodString, `sha256:${string}`, string>>;
    signature: z.ZodOptional<z.ZodObject<{
        scheme: z.ZodEnum<["ed25519", "secp256k1", "eip191", "eip712", "passkey-p256"]>;
        signer: z.ZodString;
        key_id: z.ZodString;
        value: z.ZodString;
    }, "strict", z.ZodTypeAny, {
        value: string;
        scheme: "ed25519" | "secp256k1" | "eip191" | "eip712" | "passkey-p256";
        signer: string;
        key_id: string;
    }, {
        value: string;
        scheme: "ed25519" | "secp256k1" | "eip191" | "eip712" | "passkey-p256";
        signer: string;
        key_id: string;
    }>>;
}, "strict", z.ZodTypeAny, {
    schema_version: "milestone.v1";
    milestone_id: string;
    milestone_revision: number;
    intent_hash: `sha256:${string}`;
    criterion_ids: string[];
    verification_policy_hash: `sha256:${string}`;
    settlement_policy_hash: `sha256:${string}`;
    allocation: {
        asset: {
            network: string;
            asset: string;
            decimals: number;
        };
        amount: string;
    };
    content_hash?: `sha256:${string}` | undefined;
    signature?: {
        value: string;
        scheme: "ed25519" | "secp256k1" | "eip191" | "eip712" | "passkey-p256";
        signer: string;
        key_id: string;
    } | undefined;
}, {
    schema_version: "milestone.v1";
    milestone_id: string;
    milestone_revision: number;
    intent_hash: string;
    criterion_ids: string[];
    verification_policy_hash: string;
    settlement_policy_hash: string;
    allocation: {
        asset: {
            network: string;
            asset: string;
            decimals: number;
        };
        amount: string;
    };
    content_hash?: string | undefined;
    signature?: {
        value: string;
        scheme: "ed25519" | "secp256k1" | "eip191" | "eip712" | "passkey-p256";
        signer: string;
        key_id: string;
    } | undefined;
}>, {
    schema_version: "milestone.v1";
    milestone_id: string;
    milestone_revision: number;
    intent_hash: `sha256:${string}`;
    criterion_ids: string[];
    verification_policy_hash: `sha256:${string}`;
    settlement_policy_hash: `sha256:${string}`;
    allocation: {
        asset: {
            network: string;
            asset: string;
            decimals: number;
        };
        amount: string;
    };
    content_hash?: `sha256:${string}` | undefined;
    signature?: {
        value: string;
        scheme: "ed25519" | "secp256k1" | "eip191" | "eip712" | "passkey-p256";
        signer: string;
        key_id: string;
    } | undefined;
}, {
    schema_version: "milestone.v1";
    milestone_id: string;
    milestone_revision: number;
    intent_hash: string;
    criterion_ids: string[];
    verification_policy_hash: string;
    settlement_policy_hash: string;
    allocation: {
        asset: {
            network: string;
            asset: string;
            decimals: number;
        };
        amount: string;
    };
    content_hash?: string | undefined;
    signature?: {
        value: string;
        scheme: "ed25519" | "secp256k1" | "eip191" | "eip712" | "passkey-p256";
        signer: string;
        key_id: string;
    } | undefined;
}>;
export type Milestone = z.infer<typeof MilestoneSchema>;
export declare const VerificationDecisionSchema: z.ZodEffects<z.ZodObject<{
    schema_version: z.ZodLiteral<"decision.v1">;
    decision_id: z.ZodString;
    verifier_id: z.ZodString;
    verifier_digest: z.ZodEffects<z.ZodString, `sha256:${string}`, string>;
    intent_hash: z.ZodEffects<z.ZodString, `sha256:${string}`, string>;
    milestone_id: z.ZodString;
    milestone_revision: z.ZodNumber;
    bundle_id: z.ZodString;
    evidence_root: z.ZodEffects<z.ZodString, `sha256:${string}`, string>;
    policy_hash: z.ZodEffects<z.ZodString, `sha256:${string}`, string>;
    /** = proofBinding({intent_hash, milestone_revision, evidence_root, policy_hash}) — anti replay. */
    proof_binding: z.ZodEffects<z.ZodString, `sha256:${string}`, string>;
    result: z.ZodEnum<["VALID", "INVALID", "INSUFFICIENT", "DISPUTED"]>;
    reason_codes: z.ZodArray<z.ZodString, "many">;
    /** Digest of the deterministic replay trace; a second verifier must reproduce it. */
    replay_digest: z.ZodEffects<z.ZodString, `sha256:${string}`, string>;
    decided_at: z.ZodEffects<z.ZodString, string, string>;
    content_hash: z.ZodOptional<z.ZodEffects<z.ZodString, `sha256:${string}`, string>>;
    signature: z.ZodOptional<z.ZodObject<{
        scheme: z.ZodEnum<["ed25519", "secp256k1", "eip191", "eip712", "passkey-p256"]>;
        signer: z.ZodString;
        key_id: z.ZodString;
        value: z.ZodString;
    }, "strict", z.ZodTypeAny, {
        value: string;
        scheme: "ed25519" | "secp256k1" | "eip191" | "eip712" | "passkey-p256";
        signer: string;
        key_id: string;
    }, {
        value: string;
        scheme: "ed25519" | "secp256k1" | "eip191" | "eip712" | "passkey-p256";
        signer: string;
        key_id: string;
    }>>;
}, "strict", z.ZodTypeAny, {
    schema_version: "decision.v1";
    bundle_id: string;
    milestone_id: string;
    milestone_revision: number;
    policy_hash: `sha256:${string}`;
    intent_hash: `sha256:${string}`;
    decision_id: string;
    verifier_id: string;
    verifier_digest: `sha256:${string}`;
    evidence_root: `sha256:${string}`;
    proof_binding: `sha256:${string}`;
    result: "VALID" | "INVALID" | "INSUFFICIENT" | "DISPUTED";
    reason_codes: string[];
    replay_digest: `sha256:${string}`;
    decided_at: string;
    content_hash?: `sha256:${string}` | undefined;
    signature?: {
        value: string;
        scheme: "ed25519" | "secp256k1" | "eip191" | "eip712" | "passkey-p256";
        signer: string;
        key_id: string;
    } | undefined;
}, {
    schema_version: "decision.v1";
    bundle_id: string;
    milestone_id: string;
    milestone_revision: number;
    policy_hash: string;
    intent_hash: string;
    decision_id: string;
    verifier_id: string;
    verifier_digest: string;
    evidence_root: string;
    proof_binding: string;
    result: "VALID" | "INVALID" | "INSUFFICIENT" | "DISPUTED";
    reason_codes: string[];
    replay_digest: string;
    decided_at: string;
    content_hash?: string | undefined;
    signature?: {
        value: string;
        scheme: "ed25519" | "secp256k1" | "eip191" | "eip712" | "passkey-p256";
        signer: string;
        key_id: string;
    } | undefined;
}>, {
    schema_version: "decision.v1";
    bundle_id: string;
    milestone_id: string;
    milestone_revision: number;
    policy_hash: `sha256:${string}`;
    intent_hash: `sha256:${string}`;
    decision_id: string;
    verifier_id: string;
    verifier_digest: `sha256:${string}`;
    evidence_root: `sha256:${string}`;
    proof_binding: `sha256:${string}`;
    result: "VALID" | "INVALID" | "INSUFFICIENT" | "DISPUTED";
    reason_codes: string[];
    replay_digest: `sha256:${string}`;
    decided_at: string;
    content_hash?: `sha256:${string}` | undefined;
    signature?: {
        value: string;
        scheme: "ed25519" | "secp256k1" | "eip191" | "eip712" | "passkey-p256";
        signer: string;
        key_id: string;
    } | undefined;
}, {
    schema_version: "decision.v1";
    bundle_id: string;
    milestone_id: string;
    milestone_revision: number;
    policy_hash: string;
    intent_hash: string;
    decision_id: string;
    verifier_id: string;
    verifier_digest: string;
    evidence_root: string;
    proof_binding: string;
    result: "VALID" | "INVALID" | "INSUFFICIENT" | "DISPUTED";
    reason_codes: string[];
    replay_digest: string;
    decided_at: string;
    content_hash?: string | undefined;
    signature?: {
        value: string;
        scheme: "ed25519" | "secp256k1" | "eip191" | "eip712" | "passkey-p256";
        signer: string;
        key_id: string;
    } | undefined;
}>;
export type VerificationDecision = z.infer<typeof VerificationDecisionSchema>;
/**
 * The protocol-recognized accepted outcome for one milestone revision after the
 * verification policy is satisfied (docs/TRUST-CHAIN.md). Receipt formation and
 * policy-aggregation execution are S1; G1 freezes the commitment structure.
 * A VerificationDecision is a verifier assertion — it is never payment authority;
 * the receipt is.
 */
export declare const OutcomeReceiptSchema: z.ZodEffects<z.ZodObject<{
    schema_version: z.ZodLiteral<"outcome-receipt.v1">;
    receipt_id: z.ZodString;
    intent_hash: z.ZodEffects<z.ZodString, `sha256:${string}`, string>;
    milestone_id: z.ZodString;
    milestone_revision: z.ZodNumber;
    evidence_root: z.ZodEffects<z.ZodString, `sha256:${string}`, string>;
    verification_policy_hash: z.ZodEffects<z.ZodString, `sha256:${string}`, string>;
    /** Deterministic accepted-decision set: non-empty, unique, strictly lexicographically ascending. */
    decision_hashes: z.ZodArray<z.ZodEffects<z.ZodString, `sha256:${string}`, string>, "many">;
    /** A receipt is not a decision: the only representable outcome is ACCEPTED. */
    accepted_result: z.ZodLiteral<"ACCEPTED">;
    issued_at: z.ZodEffects<z.ZodString, string, string>;
    content_hash: z.ZodOptional<z.ZodEffects<z.ZodString, `sha256:${string}`, string>>;
    signature: z.ZodOptional<z.ZodObject<{
        scheme: z.ZodEnum<["ed25519", "secp256k1", "eip191", "eip712", "passkey-p256"]>;
        signer: z.ZodString;
        key_id: z.ZodString;
        value: z.ZodString;
    }, "strict", z.ZodTypeAny, {
        value: string;
        scheme: "ed25519" | "secp256k1" | "eip191" | "eip712" | "passkey-p256";
        signer: string;
        key_id: string;
    }, {
        value: string;
        scheme: "ed25519" | "secp256k1" | "eip191" | "eip712" | "passkey-p256";
        signer: string;
        key_id: string;
    }>>;
}, "strict", z.ZodTypeAny, {
    schema_version: "outcome-receipt.v1";
    milestone_id: string;
    milestone_revision: number;
    intent_hash: `sha256:${string}`;
    verification_policy_hash: `sha256:${string}`;
    evidence_root: `sha256:${string}`;
    receipt_id: string;
    decision_hashes: `sha256:${string}`[];
    accepted_result: "ACCEPTED";
    issued_at: string;
    content_hash?: `sha256:${string}` | undefined;
    signature?: {
        value: string;
        scheme: "ed25519" | "secp256k1" | "eip191" | "eip712" | "passkey-p256";
        signer: string;
        key_id: string;
    } | undefined;
}, {
    schema_version: "outcome-receipt.v1";
    milestone_id: string;
    milestone_revision: number;
    intent_hash: string;
    verification_policy_hash: string;
    evidence_root: string;
    receipt_id: string;
    decision_hashes: string[];
    accepted_result: "ACCEPTED";
    issued_at: string;
    content_hash?: string | undefined;
    signature?: {
        value: string;
        scheme: "ed25519" | "secp256k1" | "eip191" | "eip712" | "passkey-p256";
        signer: string;
        key_id: string;
    } | undefined;
}>, {
    schema_version: "outcome-receipt.v1";
    milestone_id: string;
    milestone_revision: number;
    intent_hash: `sha256:${string}`;
    verification_policy_hash: `sha256:${string}`;
    evidence_root: `sha256:${string}`;
    receipt_id: string;
    decision_hashes: `sha256:${string}`[];
    accepted_result: "ACCEPTED";
    issued_at: string;
    content_hash?: `sha256:${string}` | undefined;
    signature?: {
        value: string;
        scheme: "ed25519" | "secp256k1" | "eip191" | "eip712" | "passkey-p256";
        signer: string;
        key_id: string;
    } | undefined;
}, {
    schema_version: "outcome-receipt.v1";
    milestone_id: string;
    milestone_revision: number;
    intent_hash: string;
    verification_policy_hash: string;
    evidence_root: string;
    receipt_id: string;
    decision_hashes: string[];
    accepted_result: "ACCEPTED";
    issued_at: string;
    content_hash?: string | undefined;
    signature?: {
        value: string;
        scheme: "ed25519" | "secp256k1" | "eip191" | "eip712" | "passkey-p256";
        signer: string;
        key_id: string;
    } | undefined;
}>;
export type OutcomeReceipt = z.infer<typeof OutcomeReceiptSchema>;
export declare const SettlementOutputSchema: z.ZodObject<{
    recipient: z.ZodString;
    asset: z.ZodObject<{
        network: z.ZodString;
        asset: z.ZodString;
        decimals: z.ZodNumber;
    }, "strict", z.ZodTypeAny, {
        network: string;
        asset: string;
        decimals: number;
    }, {
        network: string;
        asset: string;
        decimals: number;
    }>;
    amount: z.ZodString;
    reason: z.ZodString;
}, "strict", z.ZodTypeAny, {
    asset: {
        network: string;
        asset: string;
        decimals: number;
    };
    amount: string;
    recipient: string;
    reason: string;
}, {
    asset: {
        network: string;
        asset: string;
        decimals: number;
    };
    amount: string;
    recipient: string;
    reason: string;
}>;
export type SettlementOutput = z.infer<typeof SettlementOutputSchema>;
/**
 * Receipt-gated settlement (docs/TRUST-CHAIN.md): the ONLY authority field is
 * `outcome_receipt_hash`. `decision_id` and `proof_binding` are forbidden
 * authority fields in V1 — a raw VerificationDecision cannot authorize settlement.
 */
export declare const SettlementInstructionSchema: z.ZodEffects<z.ZodObject<{
    schema_version: z.ZodLiteral<"settlement.v1">;
    settlement_id: z.ZodString;
    escrow_ref: z.ZodString;
    outcome_receipt_hash: z.ZodEffects<z.ZodString, `sha256:${string}`, string>;
    nonce: z.ZodEffects<z.ZodString, string, string>;
    outputs: z.ZodArray<z.ZodObject<{
        recipient: z.ZodString;
        asset: z.ZodObject<{
            network: z.ZodString;
            asset: z.ZodString;
            decimals: z.ZodNumber;
        }, "strict", z.ZodTypeAny, {
            network: string;
            asset: string;
            decimals: number;
        }, {
            network: string;
            asset: string;
            decimals: number;
        }>;
        amount: z.ZodString;
        reason: z.ZodString;
    }, "strict", z.ZodTypeAny, {
        asset: {
            network: string;
            asset: string;
            decimals: number;
        };
        amount: string;
        recipient: string;
        reason: string;
    }, {
        asset: {
            network: string;
            asset: string;
            decimals: number;
        };
        amount: string;
        recipient: string;
        reason: string;
    }>, "many">;
    total_amount: z.ZodString;
    expires_at: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
    content_hash: z.ZodOptional<z.ZodEffects<z.ZodString, `sha256:${string}`, string>>;
}, "strict", z.ZodTypeAny, {
    schema_version: "settlement.v1";
    settlement_id: string;
    escrow_ref: string;
    outcome_receipt_hash: `sha256:${string}`;
    nonce: string;
    outputs: {
        asset: {
            network: string;
            asset: string;
            decimals: number;
        };
        amount: string;
        recipient: string;
        reason: string;
    }[];
    total_amount: string;
    content_hash?: `sha256:${string}` | undefined;
    expires_at?: string | undefined;
}, {
    schema_version: "settlement.v1";
    settlement_id: string;
    escrow_ref: string;
    outcome_receipt_hash: string;
    nonce: string;
    outputs: {
        asset: {
            network: string;
            asset: string;
            decimals: number;
        };
        amount: string;
        recipient: string;
        reason: string;
    }[];
    total_amount: string;
    content_hash?: string | undefined;
    expires_at?: string | undefined;
}>, {
    schema_version: "settlement.v1";
    settlement_id: string;
    escrow_ref: string;
    outcome_receipt_hash: `sha256:${string}`;
    nonce: string;
    outputs: {
        asset: {
            network: string;
            asset: string;
            decimals: number;
        };
        amount: string;
        recipient: string;
        reason: string;
    }[];
    total_amount: string;
    content_hash?: `sha256:${string}` | undefined;
    expires_at?: string | undefined;
}, {
    schema_version: "settlement.v1";
    settlement_id: string;
    escrow_ref: string;
    outcome_receipt_hash: string;
    nonce: string;
    outputs: {
        asset: {
            network: string;
            asset: string;
            decimals: number;
        };
        amount: string;
        recipient: string;
        reason: string;
    }[];
    total_amount: string;
    content_hash?: string | undefined;
    expires_at?: string | undefined;
}>;
export type SettlementInstruction = z.infer<typeof SettlementInstructionSchema>;
type Hashable = {
    schema_version: string;
    content_hash?: Hash | undefined;
    signature?: unknown;
};
/** content_hash for a protocol object (content_hash/signature are excluded from the preimage). */
export declare function contentHash<T extends Hashable>(o: T): Hash;
/**
 * Validate + compute content_hash. If the input already carries a content_hash it must match —
 * this is the tamper check for received objects.
 */
export declare function seal<T>(schema: z.ZodType<T & Hashable>, input: unknown): T & {
    content_hash: Hash;
};
export {};
//# sourceMappingURL=objects.d.ts.map