import { PREMIUM_GROUP, TEST_USERS_GROUP } from '@jobdeputy/shared';
import { EXTENSION_SCOPES, extensionRedirectUrl } from '@jobdeputy/shared/extension';
import { Aws, Duration, Fn, type RemovalPolicy } from 'aws-cdk-lib';
import {
  AccountRecovery,
  CfnUserPoolGroup,
  FeaturePlan,
  ManagedLoginVersion,
  Mfa,
  OAuthScope,
  UserPool,
  type UserPoolClient,
  UserPoolClientIdentityProvider,
  type UserPoolDomain,
  UserPoolEmail,
} from 'aws-cdk-lib/aws-cognito';
import { Construct } from 'constructs';
import { extensionBranding } from './extension-branding.js';

export interface AuthProps {
  readonly namePrefix: string;
  readonly removalPolicy: RemovalPolicy;
  /** Prod pools cannot be deleted by accident: deleting one deletes every account. */
  readonly deletionProtection: boolean;
  /**
   * Chrome extension IDs that may sign in (#54): dev stacks trust the dev ID too, whose key is
   * public; prod only the store item's. None: no extension client, managed login, or branding.
   */
  readonly extensionIds: readonly string[];
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
  /** The browser extension's sign-in (#54), when the stage trusts an extension ID. */
  readonly extension?: {
    /** Its client: managed login, code + PKCE. */
    client: UserPoolClient;
    /** Managed login's address, `https://jobdeputy-<stack ID part>.auth.<region>.amazoncognito.com`. */
    domain: UserPoolDomain;
  };
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

    if (props.extensionIds.length > 0) {
      // #54 (decision 0020): the browser extension signs in through managed login (v2), which
      // the Essentials plan includes. Prefixes are global to a Region and may not contain `aws`,
      // `amazon` or `cognito` (an owner such as "dawson" would), so the prefix is not the
      // stack's name but `jobdeputy-` and the first part of the stack's own ID: no one else can
      // take it first, and a stack made again gets a fresh one.
      const stackUuid = Fn.select(2, Fn.split('/', Aws.STACK_ID));
      const domain = this.userPool.addDomain('Domain', {
        cognitoDomain: {
          domainPrefix: Fn.join('', ['jobdeputy-', Fn.select(0, Fn.split('-', stackUuid))]),
        },
        managedLoginVersion: ManagedLoginVersion.NEWER_MANAGED_LOGIN,
      });
      // Public (no secret: an extension can't keep one), authorization code only (the extension
      // sends PKCE), back to the extension's own chromiumapp.org address, which only Chrome can
      // open for that extension. No direct sign-in flow: `authFlows` leaves only refresh. No
      // sign-out address: "Use a different account" goes through /logout back to sign-in.
      const client = this.userPool.addClient('ExtensionClient', {
        userPoolClientName: 'extension',
        authFlows: { userSrp: false },
        generateSecret: false,
        preventUserExistenceErrors: true,
        enableTokenRevocation: true,
        supportedIdentityProviders: [UserPoolClientIdentityProvider.COGNITO],
        oAuth: {
          flows: { authorizationCodeGrant: true },
          scopes: EXTENSION_SCOPES.map((scope) => OAuthScope.custom(scope)),
          callbackUrls: props.extensionIds.map(extensionRedirectUrl),
        },
        ...tokenValidity,
      });
      // Managed login's look for the extension's client (each client has its own branding).
      const branding = extensionBranding(this, 'ExtensionBranding', {
        userPoolId: this.userPool.userPoolId,
        clientId: client.userPoolClientId,
      });
      branding.node.addDependency(domain);
      this.extension = { client, domain };
    }

    // #74: higher limits for members; an admin adds a user by hand (runbook crawl-limits.md).
    new CfnUserPoolGroup(this, 'PremiumGroup', {
      userPoolId: this.userPool.userPoolId,
      groupName: PREMIUM_GROUP,
      description: 'Premium tier: higher usage limits. Added by an admin only.',
    });

    if (props.testsClient) {
      // Every integration-test user joins this group; the dev reaper only looks inside it (T13).
      new CfnUserPoolGroup(this, 'TestUsersGroup', {
        userPoolId: this.userPool.userPoolId,
        groupName: TEST_USERS_GROUP,
        description: 'Integration-test users only (created by CI). Never add real accounts.',
      });
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
