import type { IpcHandlers } from './dispatcher.js';
import type { SkillService } from '../application/services/skill-service.js';
import type { Skill } from '../../shared/entity.js';
import type { Scope } from '../application/ports/scope.js';
import { skillId } from '../domain/skill-id.js';
import { asBoolean, asObject, asScope, asString, optParams } from './_validators.js';

export function buildSkillHandlers(service: SkillService): IpcHandlers {
  return {
    'skill.list': async (params) => {
      const raw = optParams(params, 'skill.list');
      const scope: Scope = raw['scope'] !== undefined ? asScope(raw['scope']) : 'personal';
      return service.list(scope);
    },

    'skill.get': async (params) => {
      const raw = asObject(params, 'skill.get');
      return service.get(skillId(asString(raw['id'], 'id')));
    },

    'skill.resolvePath': async (params) => {
      const raw = asObject(params, 'skill.resolvePath');
      const absolutePath = await service.resolvePath(skillId(asString(raw['id'], 'id')));
      return { absolutePath };
    },

    'skill.save': async (params) => {
      const raw = asObject(params, 'skill.save');
      const skill = asObject(raw['skill'], 'skill') as unknown as Skill;
      const isCreate = typeof raw['isCreate'] === 'boolean' ? raw['isCreate'] : undefined;
      return service.save({ skill, ...(isCreate !== undefined ? { isCreate } : {}) });
    },

    'skill.delete': async (params) => {
      const raw = asObject(params, 'skill.delete');
      return service.delete({
        id: skillId(asString(raw['id'], 'id')),
        removeSymlinks: asBoolean(raw['removeSymlinks'], 'removeSymlinks'),
      });
    },
  };
}
