import { MAX_ROLES } from '@jobdeputy/shared/profile';
import { RolesForm, type RolesFormPlace } from '@/components/profile/roles-form.tsx';
import { QueryRegion } from '@/components/ui/query-region.tsx';
import { copy, fill } from '@/copy/index.ts';
import { useRoles } from '@/lib/api/roles.ts';
import { LoadFailed, StepIntro } from './parts.tsx';

const MAX = String(MAX_ROLES);

/** Step 2's buttons, Continue and Back, and its words for them. */
const PLACE: RolesFormPlace = {
  labelledBy: 'set-up-title',
  submit: copy.setUp.continue,
  cancel: copy.setUp.back,
  size: 'lg',
  tooMany: copy.setUp.roles.tooMany,
  changedElsewhere: copy.setUp.roles.changedElsewhere,
};

/**
 * Set it up, step 2 (#33): the job titles the deputy searches for, up to the API's 10. A title is
 * typed (with suggestions) and added, or picked from the prototype's chips; each chosen title is a
 * checked chip. Continue saves the list as target roles (`/me/roles`): the roles dropped are
 * removed, then the new ones added (`profile/roles-form.tsx`, shared with the Profile page).
 */
export function StepRoles({ onSaved, onBack }: { onSaved: () => void; onBack: () => void }) {
  const text = copy.setUp.roles;
  const roles = useRoles();
  return (
    <>
      <StepIntro eyebrow={text.eyebrow} title={text.title} intro={fill(text.intro, { max: MAX })} />
      <QueryRegion
        query={roles}
        skeleton={{ kind: 'block', rows: 3 }}
        label={text.loading}
        error={
          <LoadFailed
            error={roles.error}
            message={text.loadFailed}
            retry={text.retry}
            onRetry={() => roles.refetch()}
          />
        }
      >
        {(saved) => <RolesForm saved={saved} place={PLACE} onSaved={onSaved} onCancel={onBack} />}
      </QueryRegion>
    </>
  );
}
