"use client";
import type { FileRow } from "@/files/service";
import FilePanel from "./FilePanel";
import { tx } from "@/i18n/tx";
import type { Locale } from "@/i18n/dict";
import { deleteAttachmentAction, uploadAttachmentAction } from "../../app/supplier/events/[id]/actions";

const none = async () => ({ ok: false });

export function TenderDocsList({ files, locale = "en" }: { files: FileRow[]; locale?: Locale }) {
  return <FilePanel locale={locale} title={tx(locale, "Tender documents")} files={files} canUpload={false} canDelete={false} upload={none} remove={none} />;
}
export function MyAttachments({ eventId, files, open, locale = "en" }: { eventId: string; files: FileRow[]; open: boolean; locale?: Locale }) {
  return <FilePanel locale={locale} title={tx(locale, "Your attachments")} hint={tx(locale, "Datasheets, certificates and other support for your technical response. They stay sealed until the technical envelopes are opened.")} files={files}
    canUpload={open} canDelete={open} upload={(f) => uploadAttachmentAction(eventId, f)} remove={(id) => deleteAttachmentAction(eventId, id)} />;
}
