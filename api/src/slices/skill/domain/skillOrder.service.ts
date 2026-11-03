import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { ISkillGateway } from './skill.gateway';
import { ISkillOrder, ISkillOrderItem } from './skill.types';

/** The 409 body the console keys on to reload the list (CLEAN-205). */
export const ORDER_CHANGED = {
  statusCode: 409,
  error: 'Conflict',
  code: 'ORDER_CHANGED',
  message: 'The library order changed since you loaded it.',
} as const;

/**
 * The shared display order of the Skills page (CLEAN-205): read it with a
 * version, save it whole, refuse a save made against a version that has
 * moved on. The version is a hash of the positions themselves, so there is
 * no counter to keep and nothing to migrate — two reads of the same order
 * give the same version whatever the row order of the query.
 *
 * The controller and the `reorder_skills` tool both go through `save`; the
 * row lock and the guard live in the gateway's transaction, so a console
 * save and a chat save cannot interleave.
 */
@Injectable()
export class SkillOrderService {
  constructor(private readonly skills: ISkillGateway) {}

  version(items: ISkillOrderItem[]): string {
    const lines = [...items]
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map((i) => `${i.id}:${i.sortOrder}`)
      .join('\n');
    return createHash('sha1').update(lines).digest('hex');
  }

  async read(): Promise<ISkillOrder> {
    const items = await this.skills.readOrder();
    return { version: this.version(items), items };
  }

  async save(
    expectedVersion: string,
    items: ISkillOrderItem[],
  ): Promise<ISkillOrder> {
    this.assertDistinct(items);
    await this.skills.writeOrder(items, (current) => {
      // A permutation of exactly the skills that exist right now; a skill
      // created or deleted since the page loaded also changes the version,
      // so the console reloads rather than dropping it.
      if (this.version(current) !== expectedVersion) {
        throw new ConflictException(ORDER_CHANGED);
      }
      const known = new Set(current.map((c) => c.id));
      const sent = new Set(items.map((i) => i.id));
      if (known.size !== sent.size || [...known].some((id) => !sent.has(id))) {
        throw new BadRequestException(
          'items must list every skill exactly once',
        );
      }
    });
    return this.read();
  }

  /**
   * The chat's way to reorder: the named skills go first, in the order
   * given, everything else keeps its relative order after them. Unknown
   * names are reported, not fatal, so "put X and Y first" still does X.
   */
  async reorderByNames(
    names: string[],
  ): Promise<{ order: { name: string; position: number }[]; unknown: string[] }> {
    const [skills, current] = await Promise.all([
      this.skills.findAll(),
      this.read(),
    ]);
    const byName = new Map(skills.map((s) => [s.name, s.id]));
    const unknown = names.filter((n) => !byName.has(n));
    const front = names.filter((n) => byName.has(n)).map((n) => byName.get(n)!);
    const frontSet = new Set(front);
    const rest = current.items.map((i) => i.id).filter((id) => !frontSet.has(id));
    const ordered = [...new Set([...front, ...rest])];
    const items = ordered.map((id, index) => ({ id, sortOrder: index + 1 }));
    if (front.length > 0) await this.save(current.version, items);
    const nameOf = new Map(skills.map((s) => [s.id, s.name]));
    return {
      order: ordered.map((id, index) => ({
        name: nameOf.get(id) ?? id,
        position: index + 1,
      })),
      unknown,
    };
  }

  private assertDistinct(items: ISkillOrderItem[]): void {
    if (items.length === 0) {
      throw new BadRequestException('items must not be empty');
    }
    const ids = new Set(items.map((i) => i.id));
    const orders = new Set(items.map((i) => i.sortOrder));
    if (ids.size !== items.length) {
      throw new BadRequestException('items must not repeat a skill');
    }
    if (orders.size !== items.length) {
      throw new BadRequestException('sortOrder values must be distinct');
    }
  }
}
