import type { AttemptResult, ReasonCode, UnitStatus } from '@de-trainer/core';

// UI strings shared by several screens; the interface is Russian, learning content is German.

export const STATUS_LABEL: Record<UnitStatus, string> = {
  no_data: 'нет данных',
  learning: 'изучается',
  needs_practice: 'нужна практика',
  consolidating: 'закрепляется',
  stable: 'устойчиво',
};

export const REASON_LABEL: Record<ReasonCode, string> = {
  nomir: 'приоритет Номира',
  recent_errors: 'ошибки в последних попытках',
  new_topic: 'новая тема',
  recent_topic: 'недавнее занятие',
  due: 'пора повторить',
  variety: 'для разнообразия',
  retry: 'ещё раз после ошибки',
  practice: 'свободная практика',
};

export const RESULT_LABEL: Record<AttemptResult, string> = {
  correct: 'Верно',
  near_miss: 'Почти',
  wrong: 'Ошибка',
  skipped: 'Пропущено',
  revealed: 'Ответ показан',
};

export function plural(n: number, one: string, few: string, many: string) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return `${n} ${one}`;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return `${n} ${few}`;
  return `${n} ${many}`;
}

export function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}
