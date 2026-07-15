export type PolicyBehavior = "allow" | "error" | "warn";
export type OverrideAction = "ignore";

export interface PolicyConfigInput {
  allow?: readonly string[];
  deny?: readonly string[];
  overrides?: Readonly<Record<string, OverrideAction>>;
  production?: boolean;
  unknownLicense?: PolicyBehavior;
  unlistedLicense?: PolicyBehavior;
}

export interface PolicyConfig {
  allow: readonly string[];
  deny: readonly string[];
  overrides: Readonly<Record<string, OverrideAction>>;
  production: boolean;
  unknownLicense: PolicyBehavior;
  unlistedLicense: PolicyBehavior;
}

export const defaultPolicyConfig: PolicyConfig = Object.freeze({
  allow: Object.freeze([]),
  deny: Object.freeze([]),
  overrides: Object.freeze({}),
  production: false,
  unknownLicense: "error",
  unlistedLicense: "warn",
});
