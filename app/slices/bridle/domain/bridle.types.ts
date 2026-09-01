// Domain types for the bridle slice — the live agent chat. Envelope-free; the
// data layer maps the SDK response onto these and the store owns the reactive
// conversation state.

export enum BridleRoleTypes {
  User = 'user',
  Agent = 'agent',
}

/**
 * How an attachment reaches the agent. The distinction is visible to the
 * person: only `image` and `text` contents actually reach the model, so a
 * `binary` chip says the agent will see the file's name but not what is
 * inside it rather than letting them find out from a confused reply.
 */
export enum BridleAttachmentKinds {
  Image = 'image',
  Text = 'text',
  Binary = 'binary',
}

/** A stored attachment carried by a sent message. Metadata only, never bytes. */
export interface IBridleAttachment {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  kind: BridleAttachmentKinds;
  /** Path on the authenticated download route — never a storage URL. */
  url: string;
  readableByAgent: boolean;
}

/** Lifecycle of a file between being picked and being sendable. */
export enum BridleAttachmentStates {
  Uploading = 'uploading',
  Ready = 'ready',
  Failed = 'failed',
}

/**
 * A file chosen but not yet sent. Lives only in the compose area — it holds a
 * `File` handle and an object URL, so it is never serialized and `previewUrl`
 * must be revoked when the draft is dropped.
 */
export interface IBridleStagedAttachment {
  /** Client-minted; identifies the chip before the server knows the file. */
  localId: string;
  file: File;
  name: string;
  size: number;
  mimeType: string;
  kind: BridleAttachmentKinds;
  previewUrl: string | null;
  state: BridleAttachmentStates;
  progress: number;
  /** Server id once uploaded — this is what the send call transmits. */
  remoteId: string | null;
  /** Translation key plus params, never an assembled sentence. */
  error: IBridleAttachmentError | null;
}

/** A rejection or failure, kept translatable until it reaches the template. */
export interface IBridleAttachmentError {
  key: string;
  params?: Record<string, string | number>;
}

export interface IBridleMessage {
  id: string;
  role: BridleRoleTypes;
  text: string;
  ts: number;
  /**
   * Present on messages sent with attachments. Optional so conversations
   * persisted before this feature still hydrate unchanged.
   */
  attachments?: IBridleAttachment[];
}

/**
 * The agent's reply to a synchronous send. `messageId`/`ts` are null when the
 * agent omits them — the store fills client-side fallbacks (generated id,
 * `Date.now()`) since those are time/UI concerns, not domain data.
 */
export interface IBridleReply {
  messageId: string | null;
  text: string;
  ts: number | null;
}
