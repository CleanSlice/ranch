import { SetMetadata } from '@nestjs/common';
import { MCP_TOOL_METADATA_KEY } from './constants';
import { z } from 'zod';
import type { ToolTopic } from './topics';

export interface ToolMetadata {
  name: string;
  description: string;
  parameters?: z.ZodTypeAny;
  /** Accordion of the chat's Tools panel this tool sits in (CLEAN-109). */
  topic: ToolTopic;
  /** Human title for the panel row, sentence case, ≤ 60 chars. */
  title: string;
  /**
   * Starter prompt the panel drops into the composer: an imperative English
   * sentence with «…» placeholders. A starter, not a form — the person edits
   * it freely.
   */
  template: string;
  /**
   * The tool removes, revokes, replaces wholesale or interrupts something.
   * Such a tool must take a boolean `confirm` parameter and refuse without
   * it (see `confirmed()` in `../tooling`).
   */
  destructive?: boolean;
}

export interface ToolOptions {
  name: string;
  description: string;
  parameters?: z.ZodTypeAny;
  topic: ToolTopic;
  title: string;
  template: string;
  destructive?: boolean;
}

/**
 * Decorator that marks a provider method as an MCP tool.
 *
 * `topic`, `title` and `template` are required: the registry refuses to boot
 * a tool without them (CLEAN-109), so a new console capability cannot ship a
 * tool the Tools panel cannot show.
 *
 * @param {Object} options - The options for the decorator
 * @param {string} options.name - The name of the tool
 * @param {string} options.description - The description of the tool
 * @param {z.ZodTypeAny} [options.parameters] - The parameters of the tool
 * @returns {MethodDecorator} - The decorator
 */
export const Tool = (options: ToolOptions) => {
  return SetMetadata(MCP_TOOL_METADATA_KEY, {
    ...options,
    parameters: options.parameters ?? z.object({}),
  });
};
