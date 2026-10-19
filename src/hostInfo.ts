export interface HostGroup {
  env?: string;
  [key: string]: unknown;
}

export interface MatchedGroup {
  pattern: string;
  group: HostGroup;
}

export const UNKNOWN_ENV = "판별 불가 — 운영으로 간주";

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped.replace(/\*/g, ".*").replace(/\?/g, ".")}$`);
}

function literalLength(pattern: string): number {
  return pattern.replace(/[*?]/g, "").length;
}

/** 호스트에 매칭되는 hostGroups 를 구체적인 패턴(와일드카드 외 글자가 많은 순)부터 돌려준다 */
export function matchHostGroups(host: string, hostGroups: Record<string, HostGroup>): MatchedGroup[] {
  return Object.entries(hostGroups)
    .filter(([pattern]) => globToRegExp(pattern).test(host))
    .sort(([a], [b]) => literalLength(b) - literalLength(a))
    .map(([pattern, group]) => ({ pattern, group }));
}

/** 가장 구체적인 그룹부터 env 를 찾는다. 어느 그룹에도 없으면 운영으로 간주한다 */
export function resolveEnv(matched: MatchedGroup[]): string {
  return matched.find((m) => typeof m.group.env === "string")?.group.env ?? UNKNOWN_ENV;
}
