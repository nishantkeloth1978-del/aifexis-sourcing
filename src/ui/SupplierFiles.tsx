"use client";
import type { FileRow } from "@/files/service";
import FilePanel from "./FilePanel";
import { deleteAttachmentAction, uploadAttachmentAction } from "../../app/supplier/events/[id]/actions";

const none = async () => ({ ok: false });

export function TenderDocsList({ files }: { files: FileRow[] }) {
  return <FilePanel title="Tender documents" files={files} canUpload={false} canDelete={false} upload={none} remove={none} />;
}
export function MyAttachments({ eventId, files, open }: { eventId: string; files: FileRow[]; open: boolean }) {
  return <FilePanel title="Your attachments" hint="Datasheets, certificates and other support for your technical response. They stay sealed until the technical envelopes are opened." files={files}
    canUpload={open} canDelete={open} upload={(f) => uploadAttachmentAction(eventId, f)} remove={(id) => deleteAttachmentAction(eventId, id)} />;
}
