import { useEffect, useRef, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { ClerkProvider, SignIn, SignUp, useClerk } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { shadcn } from '@clerk/themes';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { BookingPage, HomePage, JobPage, ProviderDetailPage, ProviderPage } from '@/pages/marketplace';
import { Route, Switch, useLocation, Router as WouterRouter } from 'wouter';

const queryClient = new QueryClient();
const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
const clerkPubKey = publishableKeyFromHost(window.location.hostname, import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;

function stripBase(path: string) {
  return basePath && path.startsWith(basePath) ? path.slice(basePath.length) || '/' : path;
}

if (!clerkPubKey) throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY in .env file');

const clerkAppearance = {
  theme: shadcn,
  cssLayerName: 'clerk',
  options: {
    logoPlacement: 'inside' as const,
    logoLinkUrl: basePath || '/',
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
  },
  variables: {
    colorPrimary: '#3f8067',
    colorForeground: '#26373d',
    colorMutedForeground: '#69767a',
    colorDanger: '#b44943',
    colorBackground: '#fbfaf6',
    colorInput: '#fbfaf6',
    colorInputForeground: '#26373d',
    colorNeutral: '#d9d5c9',
    fontFamily: 'DM Sans, sans-serif',
    borderRadius: '0.7rem',
  },
  elements: {
    rootBox: 'w-full flex justify-center',
    cardBox: 'bg-[#fbfaf6] rounded-2xl w-[440px] max-w-full overflow-hidden border border-[#d9d5c9]',
    card: '!shadow-none !border-0 !bg-transparent !rounded-none',
    footer: '!shadow-none !border-0 !bg-transparent !rounded-none',
    headerTitle: 'text-[#26373d] font-bold tracking-tight',
    headerSubtitle: 'text-[#69767a]',
    socialButtonsBlockButtonText: 'text-[#26373d] font-semibold',
    formFieldLabel: 'text-[#26373d] font-semibold',
    footerActionLink: 'text-[#3f8067] font-semibold',
    footerActionText: 'text-[#69767a]',
    dividerText: 'text-[#69767a]',
    identityPreviewEditButton: 'text-[#3f8067]',
    formFieldSuccessText: 'text-[#3f8067]',
    alertText: 'text-[#923d37]',
    logoBox: 'rounded-xl overflow-hidden',
    logoImage: 'rounded-lg',
    socialButtonsBlockButton: 'border-[#d9d5c9] bg-[#f6f3e8] hover:bg-[#eeeadf]',
    formButtonPrimary: 'bg-[#3f8067] hover:bg-[#356d58] text-white shadow-none',
    formFieldInput: 'border-[#d9d5c9] bg-[#fbfaf6] text-[#26373d]',
    footerAction: 'text-[#69767a]',
    dividerLine: 'bg-[#d9d5c9]',
    alert: 'border-[#d9b9b4] bg-[#fff5f2]',
    otpCodeFieldInput: 'border-[#d9d5c9] bg-[#fbfaf6] text-[#26373d]',
    formFieldRow: 'text-[#26373d]',
    main: 'text-[#26373d]',
  },
};

function SignInPage() {
  const forceRedirectUrl = oauthCallbackUrl();
  return <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4 py-10"><div className="w-full max-w-[440px]"><div className="mb-6 text-center"><p className="serif text-3xl font-extrabold tracking-[-.06em]">sentin<span className="text-primary">.</span></p><p className="mt-2 text-sm text-muted-foreground">Local help, made clear.</p></div><SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} forceRedirectUrl={forceRedirectUrl}/></div></div>;
}
function SignUpPage() {
  const forceRedirectUrl = oauthCallbackUrl();
  return <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4 py-10"><div className="w-full max-w-[440px]"><div className="mb-6 text-center"><p className="serif text-3xl font-extrabold tracking-[-.06em]">sentin<span className="text-primary">.</span></p><p className="mt-2 text-sm text-muted-foreground">Local help, made clear.</p></div><SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} forceRedirectUrl={forceRedirectUrl}/></div></div>;
}

function oauthCallbackUrl(): string | undefined {
  const target = new URLSearchParams(window.location.search).get('redirect_url');
  if (!target) return undefined;
  try {
    const url = new URL(target, window.location.origin);
    if (url.origin === window.location.origin && url.pathname === '/api/oauth/authorize') {
      return url.toString();
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const client = useQueryClient();
  const prevUserIdRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (prevUserIdRef.current !== undefined && prevUserIdRef.current !== userId) client.clear();
      prevUserIdRef.current = userId;
    });
    return unsubscribe;
  }, [addListener, client]);
  return null;
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function ClerkRoutes() {
  const [, setLocation] = useLocation();
  return <ClerkProvider
    publishableKey={clerkPubKey}
    proxyUrl={clerkProxyUrl}
    appearance={clerkAppearance}
    signInUrl={`${basePath}/sign-in`}
    signUpUrl={`${basePath}/sign-up`}
    localization={{
      signIn: { start: { title: 'Welcome back', subtitle: 'Sign in to continue with your service requests.' } },
      signUp: { start: { title: 'Create your Sentin account', subtitle: 'Keep requests, quotes and bookings together.' } },
    }}
    routerPush={(to: string) => setLocation(stripBase(to))}
    routerReplace={(to: string) => setLocation(stripBase(to), { replace: true })}
  >
    <QueryClientProvider client={queryClient}>
      <ClerkQueryClientCacheInvalidator/>
      <TooltipProvider>
        <RoutedErrorBoundary>
          <Switch>
            <Route path="/" component={HomePage}/>
            <Route path="/jobs/:jobId" component={JobPage}/>
            <Route path="/bookings/:bookingId" component={BookingPage}/>
            <Route path="/providers/:providerId" component={ProviderDetailPage}/>
            <Route path="/provider" component={ProviderPage}/>
            <Route path="/sign-in/*?" component={SignInPage}/>
            <Route path="/sign-up/*?" component={SignUpPage}/>
            <Route component={NotFound}/>
          </Switch>
        </RoutedErrorBoundary>
        <Toaster/>
      </TooltipProvider>
    </QueryClientProvider>
  </ClerkProvider>;
}

function App() {
  return <WouterRouter base={basePath}><ClerkRoutes/></WouterRouter>;
}

export default App;