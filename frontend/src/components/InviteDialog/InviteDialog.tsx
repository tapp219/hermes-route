import { useEffect, useRef, useState } from 'react';
import QRCode from '../QRCode/QRCode';
import './InviteDialog.css';

interface Props {
  open: boolean;
  link: string;
  onClose: () => void;
}

export default function InviteDialog({ open, link, onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
    if (!open) setCopied(false);
  }, [open]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      inputRef.current?.select(); // clipboard blocked: let the user copy by hand
    }
  };

  return (
    <dialog
      ref={dialogRef}
      className="invite"
      aria-labelledby="invite-title"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose(); // click on the backdrop
      }}
    >
      <div className="invite__body">
        <h2 id="invite-title" className="invite__title">Invite someone</h2>
        <p className="invite__text">Share this link or let them scan the code. It belongs to this session and is replaced when a new session starts.</p>
        <div className="invite__qr">
          <QRCode value={link} label="QR code for the session invite link" />
        </div>
        <div className="invite__row">
          <label htmlFor="invite-link" className="sr-only">Invite link</label>
          <input id="invite-link" ref={inputRef} className="invite__input" readOnly value={link} onFocus={(e) => e.currentTarget.select()} />
          <button type="button" className="invite__copy" onClick={copy}>
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
        <p className="sr-only" role="status">{copied ? 'Link copied to clipboard' : ''}</p>
        <button type="button" className="invite__close" onClick={onClose}>Close</button>
      </div>
    </dialog>
  );
}
