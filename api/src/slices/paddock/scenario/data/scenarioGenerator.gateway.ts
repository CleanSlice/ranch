import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ILlmGateway } from '#/llm/domain';
import {
  IPaddockScenarioGeneratorGateway,
  IGeneratePaddockScenarioInput,
} from '../domain/scenarioGenerator.gateway';
import {
  ICreatePaddockScenarioData,
  IPaddockScenarioMessage,
  IPaddockSuccessCriterion,
  IPaddockScenarioSetup,
  PaddockScenarioCategory,
  PaddockScenarioDifficulty,
  PaddockEvalDimension,
} from '../domain/scenario.types';

const PROMPT_TEMPLATE = `You are a test scenario architect for an AI agent eval framework called paddock.

A user has described a problem they want to test the agent on. Generate ONE concrete test scenario in the paddock format.

User's description:
"""
{{description}}
"""

Constraints:
- category MUST be one of: tool_use, memory, conversation, patching_workflow, edge_case, multi_turn, error_recovery
- difficulty MUST be one of: easy, medium, hard, adversarial
- successCriteria.dimension MUST be one of: correctness, tool_usage, soul_compliance, response_quality, error_handling
- successCriteria weights MUST sum to 1.0
- messages SHOULD be a realistic conversation that triggers the failure or behavior described
- "from" field SHOULD be "eval-user" unless multi-user simulation is the point

{{categoryHint}}{{difficultyHint}}

Output ONLY a valid JSON object (no markdown fences, no commentary), shaped like:
{
  "category": "...",
  "difficulty": "...",
  "name": "kebab-case short identifier (no spaces)",
  "description": "1 sentence on what this tests",
  "expectedBehavior": "what the agent SHOULD do",
  "messages": [
    { "text": "...", "from": "eval-user" }
  ],
  "successCriteria": [
    { "dimension": "...", "description": "...", "weight": 0.5 }
  ]
}`;

const ANTHROPIC_DEFAULT_MODEL = 'claude-sonnet-4-6';

@Injectable()
export class PaddockScenarioGeneratorGateway extends IPaddockScenarioGeneratorGateway {
  private readonly logger = new Logger(PaddockScenarioGeneratorGateway.name);

  constructor(private llms: ILlmGateway) {
    super();
  }

  async generate(
    input: IGeneratePaddockScenarioInput,
  ): Promise<ICreatePaddockScenarioData> {
    if (!input.description?.trim()) {
      throw new BadRequestException('description is required');
    }

    const credential = await this.pickCredential(input.credentialId);
    const provider = credential.provider.toLowerCase();
    if (provider !== 'claude' && provider !== 'anthropic') {
      throw new BadRequestException(
        `Scenario generation currently supports only Anthropic / Claude credentials (got "${credential.provider}").`,
      );
    }

    const prompt = PROMPT_TEMPLATE.replace('{{description}}', input.description)
      .replace(
        '{{categoryHint}}',
        input.category ? `Force category to "${input.category}". ` : '',
      )
      .replace(
        '{{difficultyHint}}',
        input.difficulty ? `Force difficulty to "${input.difficulty}". ` : '',
      );

    const raw = await this.callClaude(
      credential.apiKey,
      credential.model || ANTHROPIC_DEFAULT_MODEL,
      prompt,
    );
    const parsed = parseScenarioJson(raw);
    if (!parsed) {
      throw new BadRequestException(
        `Generator returned no valid JSON. Raw output: ${raw.slice(0, 300)}`,
      );
    }

    return {
      templateId: input.templateId ?? null,
      agentId: input.agentId ?? null,
      category: parsed.category,
      difficulty: parsed.difficulty,
      name: parsed.name,
      description: parsed.description,
      expectedBehavior: parsed.expectedBehavior,
      messages: parsed.messages,
      successCriteria: parsed.successCriteria,
      setup: parsed.setup ?? null,
    };
  }

  private async pickCredential(id?: string) {
    if (id) {
      const cred = await this.llms.findById(id);
      if (!cred) throw new NotFoundException(`LlmCredential ${id} not found`);
      return cred;
    }
    const all = await this.llms.findActive();
    const anthropic = all.find(
      (c) =>
        c.provider.toLowerCase() === 'claude' ||
        c.provider.toLowerCase() === 'anthropic',
    );
    if (!anthropic) {
      throw new BadRequestException(
        'No active Anthropic LlmCredential found. Add one in Settings → LLM credentials.',
      );
    }
    return anthropic;
  }

  private async callClaude(
    apiKey: string,
    model: string,
    prompt: string,
  ): Promise<string> {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: 2048,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new BadRequestException(
        `Anthropic API ${res.status}: ${errBody.slice(0, 300)}`,
      );
    }

    const json = (await res.json()) as {
      content?: Array<{ type: string; text?: string }>;
    };
    const text = (json.content ?? [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text ?? '')
      .join('\n')
      .trim();
    if (!text) {
      throw new BadRequestException('Anthropic returned empty text content');
    }
    return text;
  }
}

interface ParsedScenario {
  category: PaddockScenarioCategory;
  difficulty: PaddockScenarioDifficulty;
  name: string;
  description: string;
  expectedBehavior: string;
  messages: IPaddockScenarioMessage[];
  successCriteria: IPaddockSuccessCriterion[];
  setup?: IPaddockScenarioSetup;
}

function parseScenarioJson(raw: string): ParsedScenario | null {
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  const objectMatch = cleaned.match(/\{[\s\S]*\}/);
  if (!objectMatch) return null;
  try {
    const obj = JSON.parse(objectMatch[0]) as Record<string, unknown>;
    if (
      typeof obj.category !== 'string' ||
      typeof obj.difficulty !== 'string' ||
      typeof obj.name !== 'string' ||
      !Array.isArray(obj.messages) ||
      !Array.isArray(obj.successCriteria)
    ) {
      return null;
    }
    return {
      category: obj.category as PaddockScenarioCategory,
      difficulty: obj.difficulty as PaddockScenarioDifficulty,
      name: obj.name,
      description: typeof obj.description === 'string' ? obj.description : '',
      expectedBehavior:
        typeof obj.expectedBehavior === 'string' ? obj.expectedBehavior : '',
      messages: (obj.messages as Array<Record<string, unknown>>).map((m) => ({
        text: String(m.text ?? ''),
        from: String(m.from ?? 'eval-user'),
        delayMs: typeof m.delayMs === 'number' ? m.delayMs : undefined,
      })),
      successCriteria: (obj.successCriteria as Array<Record<string, unknown>>).map(
        (c) => ({
          dimension: c.dimension as PaddockEvalDimension,
          description: String(c.description ?? ''),
          weight: Number(c.weight ?? 0),
        }),
      ),
      setup:
        obj.setup && typeof obj.setup === 'object'
          ? (obj.setup as IPaddockScenarioSetup)
          : undefined,
    };
  } catch {
    return null;
  }
}
