import { Stack, type StackProps, Tags } from 'aws-cdk-lib';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import type { Construct } from 'constructs';
import { CELLS, type CellId } from '../config/cells.js';
import type { StageName } from '../config/stages.js';

export interface CellStackProps extends StackProps {
  readonly stage: StageName;
  readonly cell: CellId;
  /** Set for personal developer stacks, for example "nava". */
  readonly owner?: string;
}

/**
 * Everything one Region cell needs. T03 deploys only a marker parameter;
 * T04 adds the API, table, queue, and workers.
 */
export class CellStack extends Stack {
  constructor(scope: Construct, id: string, props: CellStackProps) {
    super(scope, id, props);

    Tags.of(this).add('project', 'jobdeputy');
    Tags.of(this).add('stage', props.stage);
    Tags.of(this).add('cell', props.cell);
    if (props.owner) Tags.of(this).add('owner', props.owner);

    // Free (standard tier). Lets a deploy be verified end to end.
    new StringParameter(this, 'CellInfo', {
      parameterName: `/jobdeputy/${id}/cell-info`,
      stringValue: JSON.stringify({
        stage: props.stage,
        cell: props.cell,
        region: CELLS[props.cell].region,
        owner: props.owner ?? null,
      }),
    });
  }
}
