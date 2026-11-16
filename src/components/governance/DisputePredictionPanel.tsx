import React from 'react';
import type { DisputePrediction } from '../../types';

type DisputePredictionPanelProps = {
  prediction: DisputePrediction;
  isLoading: boolean;
};

const readText = (primary?: string, alias?: string, fallback = '') =>
  String(primary ?? alias ?? fallback).trim();

const readList = (primary?: string[], alias?: string[]) => {
  const values = primary ?? alias ?? [];
  return values.filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
};

const confidenceLabel = (value?: number) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const percentage = Math.round(Math.max(0, Math.min(1, value > 1 ? value / 100 : value)) * 100);
  return `${percentage}%`;
};

const DisputePredictionPanel: React.FC<DisputePredictionPanelProps> = ({ prediction, isLoading }) => {
  if (isLoading) {
    return (
      <section className="rounded-xl border border-indigo-100 bg-indigo-50 p-4" aria-busy="true" aria-live="polite">
        <p className="text-sm font-semibold text-indigo-900">Preparing dispute assessment…</p>
      </section>
    );
  }

  const outcome = readText(prediction.predicted_outcome, prediction.predictedOutcome, 'No outcome estimate');
  const risk = readText(prediction.risk_level, prediction.riskLevel, 'Not assessed');
  const confidence = confidenceLabel(prediction.confidence_score ?? prediction.confidenceScore);
  const factors = readList(prediction.key_factors, prediction.keyFactors);
  const gaps = readList(prediction.evidence_gaps, prediction.evidenceGaps);
  const resolution = readText(prediction.suggested_resolution, prediction.suggestedResolution);
  const model = readText(prediction.ai_model_used, prediction.aiModelUsed);

  return (
    <section className="rounded-xl border border-indigo-100 bg-indigo-50 p-4" aria-label="Dispute prediction">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-indigo-950">Dispute assessment</h3>
          <p className="mt-1 text-sm text-indigo-900">Predicted outcome: {outcome}</p>
        </div>
        <div className="text-right text-xs text-indigo-800">
          <p>Risk: <span className="font-semibold">{risk}</span></p>
          {confidence ? <p className="mt-1">Confidence: <span className="font-semibold">{confidence}</span></p> : null}
        </div>
      </div>

      {factors.length ? (
        <div className="mt-3">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-indigo-800">Key factors</h4>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-indigo-950">
            {factors.map((factor, index) => <li key={`${index}-${factor}`}>{factor}</li>)}
          </ul>
        </div>
      ) : null}

      {gaps.length ? (
        <div className="mt-3">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-indigo-800">Evidence gaps</h4>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-indigo-950">
            {gaps.map((gap, index) => <li key={`${index}-${gap}`}>{gap}</li>)}
          </ul>
        </div>
      ) : null}

      {resolution ? <p className="mt-3 text-sm text-indigo-950"><span className="font-semibold">Suggested resolution:</span> {resolution}</p> : null}
      {model ? <p className="mt-3 text-xs text-indigo-700">Assessment model: {model}</p> : null}
      <p className="mt-3 text-xs text-indigo-700">This is decision support, not an automatic resolution. Review the ticket evidence before taking action.</p>
    </section>
  );
};

export default DisputePredictionPanel;
