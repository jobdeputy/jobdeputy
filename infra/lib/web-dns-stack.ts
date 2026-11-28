import { RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import { PublicHostedZone } from 'aws-cdk-lib/aws-route53';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import type { Construct } from 'constructs';

/**
 * The SSM parameter holding the zone's ID (#111): the site's cell reads it at deploy time, so no
 * stack export ties the cell to this stack (an export in use can't be removed).
 */
export function webZoneIdParameter(domain: string): string {
  return `/jobdeputy/web-zone/${domain}/id`;
}

export interface WebDnsStackProps extends StackProps {
  /** The delegated zone's name, for example dev.jobdeputy.com. */
  readonly domain: string;
}

/**
 * Decision 0011: the web app's Route 53 zone ($0.50 a month), in its own stack.
 *
 * The parent zone (jobdeputy.com, management account) delegates to this zone's name
 * servers once, by hand (infra/bootstrap/05-delegate-web-zone.sh). A new zone gets new
 * name servers, so the zone is kept when the stack is deleted, and the web stack's
 * certificate can only validate after the delegation exists.
 */
export class WebDnsStack extends Stack {
  readonly zone: PublicHostedZone;

  constructor(scope: Construct, id: string, props: WebDnsStackProps) {
    super(scope, id, props);
    this.zone = new PublicHostedZone(this, 'Zone', {
      zoneName: props.domain,
      comment: 'JobDeputy web app (decision 0011). Delegated from jobdeputy.com.',
    });
    this.zone.applyRemovalPolicy(RemovalPolicy.RETAIN);
    new StringParameter(this, 'ZoneId', {
      parameterName: webZoneIdParameter(props.domain),
      description: 'The web zone’s ID (read by the site’s cell for auth.<site>, #111).',
      stringValue: this.zone.hostedZoneId,
    });
  }
}
