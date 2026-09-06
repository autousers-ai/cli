/**
 * Barrel export for the TUI's interactive component layer.
 *
 * Wave 3 ships the `Modal` primitive + the main-menu `ModeSelector`. Wave
 * 4 adds `Wizard` + `AutoraterPicker`; Wave 7 adds the share / invite /
 * transfer / delete-confirm modals (built on the Wave-3 Modal); Wave 8
 * adds the AI-assisted creator screens.
 */
export { Modal } from "./modal.js";
export { ModeSelector } from "./mode-selector.js";
export { ShareModal, SHARE_ROLES } from "./share-modal.js";
export type { ShareRole, ShareResolution } from "./share-modal.js";
export { InviteModal } from "./invite-modal.js";
export type { InviteResolution } from "./invite-modal.js";
export { TransferModal } from "./transfer-modal.js";
export type { TransferResolution } from "./transfer-modal.js";
export { DeleteConfirmModal } from "./delete-confirm-modal.js";
export type { DeleteResolution } from "./delete-confirm-modal.js";
