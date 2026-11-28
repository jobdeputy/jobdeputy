import {
  PREMIUM_GROUP,
  TEST_USERS_GROUP,
  WEB_SCOPES,
  WEB_SIGN_IN_CALLBACK_PATH,
} from '@jobdeputy/shared';
import { EXTENSION_SCOPES, extensionRedirectUrl } from '@jobdeputy/shared/extension';
import { Aws, Duration, Fn, type RemovalPolicy, Stack } from 'aws-cdk-lib';
import { Certificate, CertificateValidation } from 'aws-cdk-lib/aws-certificatemanager';
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
import { AaaaRecord, ARecord, type IHostedZone, RecordTarget } from 'aws-cdk-lib/aws-route53';
import { CloudFrontTarget } from 'aws-cdk-lib/aws-route53-targets';
import { Construct } from 'constructs';
import { loginBranding } from './login-branding.js';

/** #111 (decision 0021): managed login's own address, in a zone this account holds. */
export interface SignInDomain {
  /** For example auth.dev.jobdeputy.com. */
  readonly name: string;
  /** Holds `name`'s certificate check and alias record. */
  readonly zone: IHostedZone;
}

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
  /**
   * Origins the web app signs in from through managed login, coming back to
   * `WEB_SIGN_IN_CALLBACK_PATH` (#111). None: the web client keeps only its direct sign-in.
   */
  readonly webOrigins: readonly string[];
  /** Serves managed login here as well as on the prefix domain (#111). Needs us-east-1. */
  readonly signInDomain?: SignInDomain;
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
  };
  /**
   * Where both clients sign in through managed login, when either does: `https://<signInDomain>`
   * where there is one (#111), else `https://jobdeputy-<stack ID part>.auth.<region>.amazoncognito.com`.
   * Managed login's session is a cookie on this address, so signing in to one signs in the other.
   */
  readonly signInUrl?: string;
  /** The custom domain's name, where there is one (#111). */
  readonly signInDomainName?: string;
  /** Where the web client's managed login may return (#111); none without web origins. */
  readonly webCallbackUrls: readonly string[];
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

    // The browser app, a public client (no secret). Secure remote password sign-in until it moves
    // to managed login (#111 PR B). Where it has origins, managed login too: authorization code
    // only (Amplify sends PKCE), back to the site's own callback, and sign-out back to the site.
    const webOAuth = props.webOrigins.length > 0;
    this.webCallbackUrls = props.webOrigins.map((origin) => origin + WEB_SIGN_IN_CALLBACK_PATH);
    this.webClient = this.userPool.addClient('WebClient', {
      userPoolClientName: 'web',
      authFlows: { userSrp: true },
      generateSecret: false,
      preventUserExistenceErrors: true,
      enableTokenRevocation: true,
      ...(webOAuth
        ? {
            supportedIdentityProviders: [UserPoolClientIdentityProvider.COGNITO],
            oAuth: {
              flows: { authorizationCodeGrant: true },
              scopes: WEB_SCOPES.map((scope) => OAuthScope.custom(scope)),
              callbackUrls: [...this.webCallbackUrls],
              logoutUrls: props.webOrigins.map((origin) => `${origin}/`),
            },
          }
        : { disableOAuth: true }),
      ...tokenValidity,
    });

    const oauthClients: { id: string; client: UserPoolClient }[] = [];
    if (webOAuth) oauthClients.push({ id: 'WebBranding', client: this.webClient });

    if (props.extensionIds.length > 0) {
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
      oauthClients.push({ id: 'ExtensionBranding', client });
      this.extension = { client };
    }

    if (props.signInDomain && oauthClients.length === 0) {
      throw new Error('signInDomain needs a client that signs in through managed login.');
    }
    if (oauthClients.length > 0) {
      const domains = this.addDomains(props.signInDomain);
      this.signInUrl = (domains.custom ?? domains.prefix).baseUrl();
      if (domains.custom && props.signInDomain) this.signInDomainName = props.signInDomain.name;
      // One change to the pool's managed login at a time: the clients, then the custom domain
      // (minutes to make), then each client's look.
      for (const { client } of oauthClients) domains.custom?.node.addDependency(client);
      // Managed login's look, set per client: the same for both (login-branding.ts), one after
      // the other.
      let previous: Construct = domains.custom ?? domains.prefix;
      for (const { id, client } of oauthClients) {
        const branding = loginBranding(this, id, {
          userPoolId: this.userPool.userPoolId,
          clientId: client.userPoolClientId,
        });
        branding.node.addDependency(previous);
        previous = branding;
      }
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

  /**
   * Managed login (v2, in the Essentials plan) on the pool's prefix domain (#54, decision 0020)
   * and, given a sign-in domain, on that too (#111, decision 0021). A pool may have one of each;
   * the prefix one stays for stacks and extension builds made before the custom one.
   */
  private addDomains(signIn: SignInDomain | undefined): {
    prefix: UserPoolDomain;
    custom?: UserPoolDomain;
  } {
    // Prefixes are global to a Region and may not contain `aws`, `amazon` or `cognito` (an owner
    // such as "dawson" would), so the prefix is not the stack's name but `jobdeputy-` and the
    // first part of the stack's own ID: no one else can take it first, and a stack made again
    // gets a fresh one.
    const stackUuid = Fn.select(2, Fn.split('/', Aws.STACK_ID));
    const prefix = this.userPool.addDomain('Domain', {
      cognitoDomain: {
        domainPrefix: Fn.join('', ['jobdeputy-', Fn.select(0, Fn.split('-', stackUuid))]),
      },
      managedLoginVersion: ManagedLoginVersion.NEWER_MANAGED_LOGIN,
    });
    if (!signIn) return { prefix };

    // Cognito serves a custom domain through CloudFront, so its certificate must be in us-east-1.
    if (Stack.of(this).region !== 'us-east-1') {
      throw new Error(`A sign-in domain needs us-east-1, not ${Stack.of(this).region}.`);
    }
    const certificate = new Certificate(this, 'SignInCertificate', {
      domainName: signIn.name,
      validation: CertificateValidation.fromDns(signIn.zone),
    });
    // Cognito also requires the parent (the site's own address) to resolve: the web stack's
    // alias record (decision 0021, consequences).
    const custom = this.userPool.addDomain('SignInDomain', {
      customDomain: { domainName: signIn.name, certificate },
      managedLoginVersion: ManagedLoginVersion.NEWER_MANAGED_LOGIN,
    });
    // One domain change at a time on a pool.
    custom.node.addDependency(prefix);
    // The domain's own CloudFront attribute (UserPoolDomainTarget would add a lookup Lambda).
    // IPv6 too, as the site has.
    const target = RecordTarget.fromAlias({
      bind: (record) => ({
        dnsName: custom.cloudFrontEndpoint,
        hostedZoneId: CloudFrontTarget.getHostedZoneId(record),
      }),
    });
    new ARecord(this, 'SignInRecord', { zone: signIn.zone, recordName: signIn.name, target });
    new AaaaRecord(this, 'SignInAaaa', { zone: signIn.zone, recordName: signIn.name, target });
    return { prefix, custom };
  }
}
