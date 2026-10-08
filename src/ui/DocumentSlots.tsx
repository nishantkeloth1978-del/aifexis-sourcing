"use client";
import type { FileRow } from "@/files/service";
import type { DocumentReq } from "@/templates/types";
import FilePanel from "./FilePanel";
import { tx } from "@/i18n/tx";
import type { Locale } from "@/i18n/dict";
import { lab } from "./lab";
import { deleteAttachmentAction, uploadAttachmentAction } from "../../app/supplier/events/[id]/actions";

/** One upload slot for each document the event asks for, so a required document cannot be confused with a general attachment. */
export default function DocumentSlots({ eventId, documents, files, open, locale = "en" }: { eventId: string; documents: DocumentReq[]; files: FileRow[]; open: boolean; locale?: Locale }) {
  if (documents.length === 0) return null;
  return (<div>
    <h3>{tx(locale, "Requested documents")}</h3>
    {documents.map((d) => (
      <FilePanel key={d.key} locale={locale} title={lab(d.label, locale)} hint={`${lab(d.purpose, locale)} (${d.fileTypes.join(", ")})`} files={files.filter((f) => f.docKey === d.key)} canUpload={open} canDelete={open}
        upload={(f) => { f.set("docKey", d.key); return uploadAttachmentAction(eventId, f); }} remove={(id) => deleteAttachmentAction(eventId, id)} />
    ))}
  </div>);
}
