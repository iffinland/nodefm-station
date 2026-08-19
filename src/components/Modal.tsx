/* ============================================================
 * NodeFM Station — Shared Modal Contract
 *
 * A modal may only be dismissed through its explicit close/X
 * control or when the owning flow deliberately calls `onClose`.
 * The backdrop intentionally has no click handler.
 * ============================================================ */

import { useId, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

type ModalProps = {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
};

export function Modal({ title, onClose, children, wide = false }: ModalProps) {
  const titleId = useId();

  return createPortal(
    <div className="modal-overlay">
      <div
        className={`modal${wide ? ' modal--wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="modal__header">
          <h2 className="modal__title" id={titleId}>
            {title}
          </h2>
          <button className="modal__close" type="button" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="modal__body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
