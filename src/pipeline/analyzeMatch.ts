import { analyzeMatch as analyzeMatchJs } from "./raw/analyzeMatch";
import type { AnalyzableMatch, AnalysisResult } from "../types/domain";

export function analyzeMatch(match: AnalyzableMatch): AnalysisResult {
  return analyzeMatchJs(match) as unknown as AnalysisResult;
}