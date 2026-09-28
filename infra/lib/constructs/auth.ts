import { Duration, type RemovalPolicy } from 'aws-cdk-lib';
import {
  AccountRecovery,
  FeaturePlan,
  Mfa,
  UserPool,
  type UserPoolClient,
  UserPoolEmail,
} from 'aws-cdk-lib/aws-cognito';
import { Construct } from 'constructs';

export interface AuthProps {
  readonly namePrefix: string;
  readonly removalPolicy: RemovalPolicy;
  /** Prod pools cannot be deleted by accident: deleting one deletes every account. */
  readonly deletionProtection: boolean;
  /** Adds an app client for integration tests (admin sign-in, IAM only). Dev only. */
  readonly testsClient: boolean;
}

/**
 * One Cognito user pool per cell (0004, T05). Email is the only sign-in and
 * required attribute; this cannot change after creation, so everything else
 * about the user lives in our own tables (0006).
 */
export class Auth extends Construct {
  readonly userPool: UserPool;
  readonly webClient: UserPoolClient;
  readonly testsClient?: UserPoolClient;

  constructor(scope: Construct, id: string, props: AuthProps) {
    super(scope, id);

    this.userPool = new UserPool(this, 'UserPool', {
      userPoolName: `${props.namePrefix}-users`,
      // $0 up to 10,000 monthly active users; keeps passwordless and passkeys possible.
      featurePlan: FeaturePlan.ESSENTIALS,
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      signInCaseSensitive: false,
      autoVerify: { email: true },
      standardAttributes: { email: { required: true, mutable: true } },
      // Length over composition rules (current NIST guidance).
      passwordPolicy: {
        minLength: 12,
        requireLowercase: false,
        requireUppercase: false,
        requireDigits: false,
        requireSymbols: false,
      },
      // Authenticator apps only: SMS costs money per message and is weaker.
      mfa: Mfa.OPTIONAL,
      mfaSecondFactor: { otp: true, sms: false },
      accountRecovery: AccountRecovery.EMAIL_ONLY,
      // 50 emails a day; production switches to SES (release blocker #13).
      email: UserPoolEmail.withCognito(),
      deletionProtection: props.deletionProtection,
      removalPolicy: props.removalPolicy,
    });

    const tokenValidity = {
      accessTokenValidity: Duration.hours(1),
      idTokenValidity: Duration.hours(1),
      refreshTokenValidity: Duration.days(30),
    };

    // The browser app: secure remote password sign-in only, no client secret.
    this.webClient = this.userPool.addClient('WebClient', {
      userPoolClientName: 'web',
      authFlows: { userSrp: true },
      generateSecret: false,
      preventUserExistenceErrors: true,
      enableTokenRevocation: true,
      disableOAuth: true,
      ...tokenValidity,
    });

    if (props.testsClient) {
      // Admin sign-in needs AWS credentials (cognito-idp:AdminInitiateAuth); never usable from a browser.
      this.testsClient = this.userPool.addClient('TestsClient', {
        userPoolClientName: 'integration-tests',
        authFlows: { adminUserPassword: true },
        generateSecret: false,
        preventUserExistenceErrors: true,
        disableOAuth: true,
        ...tokenValidity,
      });
    }
  }
}
