// Модуль разнесён по частям в _actions/ (каждая — "use server"); здесь — прежний путь импорта.
export { createShipment, updateShipmentHeader, deleteShipment, addShipmentLines, addCustomShipmentLine, updateShipmentLine, saveLineAcceptance, acceptAllLines, deleteShipmentLine, uploadEventDocument, removeEventDocument, createEvent, updateEvent, deleteEvent, markEventDone, createAcceptanceEvent } from "./_actions/create-shipment";
export type { ShipmentFormState, LineDraft } from "./_actions/create-shipment";
export { confirmAcceptance, cancelAcceptance, listShipmentCandidates, acceptLinesByReview, acceptAllOnReview, sendLineToRework, saveLineReworks, acceptAfterRework } from "./_actions/confirm-acceptance";
export type { ReworkInput } from "./_actions/confirm-acceptance";
