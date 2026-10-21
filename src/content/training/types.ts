/**
 * Обучение по ролям: декларативное описание шагов. Из него скрипт `npm run training:build` снимает скрины с выносками
 * и собирает PDF, а страница /training и тест `scripts/test-training.ts` читают тот же текст. Правило обновления: TRAINING-UPDATE.md.
 */

/** Ключ инструкции. owner — владелец и администратор; остальные совпадают с ролями системы. */
export type TrainingRole = "owner" | "technologist" | "purchaser" | "accountant" | "supplier";

/** Действие подготовки перед снимком. Только раскрытия и ввод без сохранения: ничего не отправляем и не создаём. */
export type Prep =
  | { click: string; nth?: number }
  | { hover: string }
  | { fill: string; value: string }
  | { press: string }
  | { wait: number };

/** Выноска на скрине: рамка с номером на элементе. `sel` — CSS или Playwright-селектор (text=, role=, :has-text()). */
export type Callout = {
  sel: string;
  /** Какой по счёту из найденных элементов (с нуля); по умолчанию первый. */
  nth?: number;
  /** Подпись к номеру под скрином. */
  label: string;
};

export type Step = {
  /** Латиницей, уникален в роли: имя файла скрина и ключ отзывов. */
  id: string;
  title: string;
  /** 1–3 коротких предложения «что сделать». */
  text: string[];
  /** Шаблон маршрута для проверки (например, "/models/[id]"): страница обязана существовать и быть доступна роли. */
  route: string;
  /** Что открыть для снимка. Если задан via — сначала список, затем первая ссылка из него. */
  url: string;
  via?: { link: string };
  prep?: Prep[];
  callouts: Callout[];
  /** Подпись «что получится». */
  result: string;
  /** Снимок только этой области (селектор); по умолчанию — вся видимая страница. Нужен, чтобы не показывать лишнее. */
  region?: string;
  /** Дополнительные файлы (от корня проекта), изменение которых делает скрин устаревшим. */
  watch?: string[];
};

export type RoleDoc = {
  role: TrainingRole;
  /** Название на вкладке и обложке. */
  tabTitle: string;
  title: string;
  /** «Что вы делаете в системе»: описание роли. */
  about: string[];
  /** Цели роли — коротким списком. */
  goals: string[];
  steps: Step[];
};
