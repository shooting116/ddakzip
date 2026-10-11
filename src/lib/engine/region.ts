import type { Rules } from './rules.ts';
import type { RegionClass } from './types.ts';

export interface RegionInfo {
  cls: RegionClass;
  label: string;
  metro: boolean;
  regulated: boolean;
  sido: string | null;
  sigungu: string | null;
  lawd: string | null;
  /** 국민주택채권 매입률 표 선택용 */
  metroCity: boolean;
}

/** 시도·시군구 → R1/R2/R3. 지역 미정이면 규제지역 기준(보수적). */
export function classifyRegion(rules: Rules, region: { sido: string; sigungu: string } | null): RegionInfo {
  if (!region) {
    return { cls: 'R1', label: '지역 미정 · 규제지역 기준', metro: true, regulated: true, sido: null, sigungu: null, lawd: null, metroCity: true };
  }
  const sido = rules.regions.sido.find((s) => s.name === region.sido);
  const sgg = sido?.sigungu.find((g) => g.name === region.sigungu) ?? sido?.sigungu[0];
  const metro = rules.regions.metro_sido.includes(region.sido);
  const regulated = !!sgg?.regulated;
  const cls: RegionClass = regulated ? 'R1' : metro ? 'R2' : 'R3';
  const label = regulated
    ? `${region.sido} ${region.sigungu} · 규제지역`
    : metro
      ? `${region.sido} ${region.sigungu} · 수도권 비규제 (수도권 규제 적용)`
      : `${region.sido} ${region.sigungu} · 지방`;
  const metroCity = rules.fees.bond.metro_city_sido.includes(region.sido);
  return { cls, label, metro, regulated, sido: region.sido, sigungu: sgg?.name ?? region.sigungu, lawd: sgg?.lawd ?? null, metroCity };
}

export function listSido(rules: Rules): string[] {
  return rules.regions.sido.map((s) => s.name);
}

export function listSigungu(rules: Rules, sido: string): string[] {
  return rules.regions.sido.find((s) => s.name === sido)?.sigungu.map((g) => g.name) ?? [];
}
