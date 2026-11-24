// Модуль разнесён по частям в _attention/; здесь — прежний путь импорта.
export type { AttentionPriority, AttentionSection, AttentionKind, AttentionProblem, AttentionEntity, AttentionGroupId } from "./_attention/shared";
export { SECTION_LABELS, KIND_LABELS, KIND_ORDER, KIND_SECTION, GROUPS, GROUP_ORDER, buildAttentionBlocks, countAttentionBlocks, normalizeModelName } from "./_attention/section-labels";
export type { AttentionGroupKind, AttentionGroupMeta, AttentionBlock } from "./_attention/section-labels";
export { countAttention, computeAttention } from "./_attention/compute-attention-impl";
