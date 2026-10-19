import { describe, it, expect } from "vitest";
import { matchHostGroups, resolveEnv, UNKNOWN_ENV } from "../hostInfo.js";

const groups = {
  "app-*": { env: "운영", description: "app 공통" },
  "app-c*": { env: "운영", description: "app 신규 존" },
  "stage-a*": { env: "알파" },
  "web-*": { description: "env 미기입" },
};

describe("matchHostGroups", () => {
  it("매칭되는 그룹을 구체적인 패턴부터 돌려준다", () => {
    const matched = matchHostGroups("app-c01", groups);
    expect(matched.map((m) => m.pattern)).toEqual(["app-c*", "app-*"]);
  });

  it("패턴의 . 등 정규식 문자는 글자 그대로 매칭한다", () => {
    expect(matchHostGroups("appXc01", { "app.c*": {} })).toEqual([]);
  });

  it("매칭되는 그룹이 없으면 빈 배열", () => {
    expect(matchHostGroups("unknown-host", groups)).toEqual([]);
  });
});

describe("resolveEnv", () => {
  it("가장 구체적인 그룹의 env 를 쓴다", () => {
    expect(resolveEnv(matchHostGroups("stage-a01", groups))).toBe("알파");
  });

  it("env 가 없으면 운영으로 간주한다", () => {
    expect(resolveEnv(matchHostGroups("web-01", groups))).toBe(UNKNOWN_ENV);
    expect(resolveEnv([])).toBe(UNKNOWN_ENV);
  });
});
