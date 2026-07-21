import { SkillGateway } from '../data/skill.gateway';
import { SkillService } from '../domain/skill.service';

/**
 * Composition root for the skill slice. Provides `$skillService`.
 */
export default defineNuxtPlugin({
  name: 'skill-di',
  setup() {
    const service = new SkillService(new SkillGateway());
    return {
      provide: {
        skillService: service,
      },
    };
  },
});
