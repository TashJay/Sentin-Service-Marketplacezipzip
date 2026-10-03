import { useState } from 'react';
import type { ReactNode, FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useLocation, useParams } from 'wouter';
import {
  useAcceptQuote, useCreateJob, useCreateProviderAvailability, useCreateProviderProfile, useGetBooking, useGetDashboardSummary, useGetProvider,
  useGetJob, useListJobMessages, useListJobQuotes, useListMyBookings, useListMyJobs, useListProviderAvailability,
  useListProviderBookings, useListProviderRequests, useListServices, useRequestQuotes, useSearchProviders,
  useSendJobMessage, useSubmitQuote, useUpdateBookingStatus, useUpdateProviderAvailability,
  getGetDashboardSummaryQueryKey, getGetJobQueryKey, getGetBookingQueryKey, getGetProviderQueryKey,
  getListJobMessagesQueryKey, getListJobQuotesQueryKey, getListMyBookingsQueryKey, getListMyJobsQueryKey,
  getListProviderAvailabilityQueryKey, getListProviderBookingsQueryKey, getListPublicProviderAvailabilityQueryKey,
  getListProviderRequestsQueryKey, getSearchProvidersQueryKey,
} from '@workspace/api-client-react';
import type { Booking, JobInput, Provider, ProviderProfileInput, QuoteInput, SearchProvidersParams } from '@workspace/api-client-react';
import { useUser, useClerk } from '@clerk/react';
import {
  ArrowLeft, ArrowRight, BadgeCheck, BriefcaseBusiness, CalendarDays, Check,
  CircleHelp, Clock3, FileText, Globe2, MapPin, Menu, MessageCircle, Search, Send, ShieldCheck,
  Sparkles, Wrench, X,
} from 'lucide-react';

const money = (amount: number, currency: string) => {
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amount); }
  catch { return `${currency} ${amount.toLocaleString()}`; }
};
const date = (value?: string | null) => value ? new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : 'Not scheduled';
const nice = (value?: string | null) => value ? value.replaceAll('_', ' ').toLowerCase().replace(/^\w/, c => c.toUpperCase()) : 'Unknown';

function Shell({ children }: { children: ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const { user, isLoaded } = useUser();
  const { signOut } = useClerk();
  return <div className="min-h-[100dvh] bg-background text-foreground">
    <header className="sticky top-0 z-30 border-b border-border/80 bg-background/95 backdrop-blur">
      <div className="mx-auto flex h-[72px] max-w-[1320px] items-center justify-between px-5 md:px-9">
        <Link href="/" className="flex items-center gap-3" data-testid="link-home">
          <span className="grid size-9 place-items-center rounded-xl bg-primary text-primary-foreground"><ShieldCheck size={20}/></span>
          <span className="serif text-[23px] font-extrabold tracking-[-.06em]">sentin<span className="text-primary">.</span></span>
        </Link>
        <nav className="hidden items-center gap-8 text-[13px] font-semibold text-muted-foreground md:flex" aria-label="Main navigation">
          <Link href="/" className="transition hover:text-foreground" data-testid="link-discover">Discover</Link>
          <Link href="/provider" className="transition hover:text-foreground" data-testid="link-for-providers">For providers</Link>
          <a href="#how-it-works" className="transition hover:text-foreground" data-testid="link-how-it-works">How it works</a>
        </nav>
        <div className="flex items-center gap-3">
          {isLoaded && user ? <><span className="hidden text-sm font-medium text-muted-foreground sm:inline">{user.firstName || user.emailAddresses[0]?.emailAddress}</span><button className="rounded-full border border-border px-4 py-2 text-sm font-semibold hover:bg-muted" onClick={() => signOut({ redirectUrl: '/' })} data-testid="button-sign-out">Sign out</button></>
            : <><Link href="/sign-in" className="hidden px-3 py-2 text-sm font-semibold text-foreground hover:text-primary sm:block" data-testid="link-sign-in">Sign in</Link><Link href="/sign-up" className="rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm transition hover:-translate-y-0.5" data-testid="link-get-started">Get started</Link></>}
          <button aria-label="Open navigation" onClick={() => setMenuOpen(!menuOpen)} className="grid size-10 place-items-center rounded-lg border border-border md:hidden" data-testid="button-menu">{menuOpen ? <X size={18}/> : <Menu size={18}/>}</button>
        </div>
      </div>
      {menuOpen && <div className="flex flex-col gap-1 border-t border-border bg-card px-5 py-3 md:hidden"><Link onClick={() => setMenuOpen(false)} href="/" className="rounded-lg px-3 py-3 text-sm font-medium" data-testid="mobile-link-discover">Discover services</Link><Link onClick={() => setMenuOpen(false)} href="/provider" className="rounded-lg px-3 py-3 text-sm font-medium" data-testid="mobile-link-provider">For providers</Link></div>}
    </header>
    {children}
    <footer className="border-t border-border bg-card/60">
      <div className="mx-auto flex max-w-[1320px] flex-col gap-4 px-5 py-8 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between md:px-9">
        <span className="font-semibold text-foreground">sentin<span className="text-primary">.</span> &nbsp; Local help, made clear.</span>
        <div className="flex flex-wrap gap-x-6 gap-y-2"><Link href="/" data-testid="footer-link-home">Find a professional</Link><Link href="/provider" data-testid="footer-link-provider">Join as a provider</Link><span>Built for real-world needs.</span></div>
      </div>
    </footer>
  </div>;
}

function LoadingRows({ count = 3 }: { count?: number }) {
  return <div className="space-y-3" aria-label="Loading"><div className="sr-only">Loading information</div>{Array.from({ length: count }, (_, i) => <div key={i} className="h-[74px] animate-pulse rounded-xl bg-muted/80" />)}</div>;
}
function ErrorNote({ message = 'We couldn’t load this information.', onRetry }: { message?: string; onRetry?: () => void }) {
  return <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/25 bg-destructive/5 p-4 text-sm text-destructive" data-testid="state-error"><span>{message}</span>{onRetry && <button type="button" onClick={onRetry} className="rounded-md border border-destructive/30 px-3 py-1.5 font-semibold hover:bg-destructive/10" data-testid="button-retry">Try again</button>}</div>;
}
function StatePanel({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return <div className="rounded-2xl border border-dashed border-border bg-card/60 px-6 py-9 text-center" data-testid="state-empty"><div className="mx-auto mb-3 grid size-11 place-items-center rounded-full bg-accent text-primary"><CircleHelp size={20}/></div><h3 className="font-semibold">{title}</h3><p className="mx-auto mt-1 max-w-md text-sm leading-6 text-muted-foreground">{body}</p>{action && <div className="mt-5">{action}</div>}</div>;
}
function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'green' | 'amber' | 'demo' }) {
  const colors = { neutral: 'bg-muted text-muted-foreground', green: 'bg-accent text-primary', amber: 'bg-amber-100 text-amber-800', demo: 'border border-amber-300 bg-amber-50 text-amber-900' };
  return <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[.08em] ${colors[tone]}`}>{children}</span>;
}
function PageWrap({ children }: { children: ReactNode }) {
  return <main className="page-enter mx-auto max-w-[1320px] px-5 pb-16 pt-8 md:px-9 md:pt-12">{children}</main>;
}

function Dashboard() {
  const summary = useGetDashboardSummary();
  const jobs = useListMyJobs();
  const bookings = useListMyBookings();
  if (summary.isLoading || jobs.isLoading || bookings.isLoading) return <div className="mt-12"><LoadingRows count={2}/></div>;
  if (summary.isError || jobs.isError || bookings.isError) return <ErrorNote message="Your activity could not be loaded." onRetry={() => { void summary.refetch(); void jobs.refetch(); void bookings.refetch(); }} />;
  return <section className="mt-16" data-testid="section-your-activity">
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4"><div><div className="text-[11px] font-bold uppercase tracking-[.18em] text-primary">Your workspace</div><h2 className="serif mt-2 text-3xl font-bold tracking-tight">Your activity</h2></div><div className="flex gap-5 text-xs text-muted-foreground"><span><b className="text-foreground">{summary.data?.openJobs ?? 0}</b> open requests</span><span><b className="text-foreground">{summary.data?.quotesReceived ?? 0}</b> quotes</span><span><b className="text-foreground">{summary.data?.activeBookings ?? 0}</b> bookings</span></div></div>
    {!jobs.data?.length && !bookings.data?.length ? <StatePanel title="Nothing in motion yet" body="Your requests, provider replies and confirmed bookings will appear here." action={<a href="#request-form" className="inline-flex rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground" data-testid="link-create-first-request">Create your first request</a>} /> :
      <div className="grid gap-5 lg:grid-cols-[1.2fr_.8fr]">
        <div className="overflow-hidden rounded-2xl border border-border bg-card"><div className="flex items-center justify-between border-b border-border px-5 py-4"><h3 className="font-semibold">Service requests</h3><span className="text-xs text-muted-foreground">{jobs.data?.length || 0} total</span></div>{jobs.data?.length ? jobs.data.map(job => <Link key={job.id} href={`/jobs/${job.id}`} className="flex items-center justify-between gap-4 border-b border-border/70 px-5 py-4 last:border-0 hover:bg-muted/40" data-testid={`row-job-${job.id}`}><div className="min-w-0"><div className="font-semibold">{job.serviceName}</div><div className="mt-1 truncate text-xs text-muted-foreground">{job.city}, {job.countryCode} · {date(job.createdAt)}</div></div><div className="flex shrink-0 items-center gap-3"><Badge tone={job.status === 'OPEN' || job.status === 'QUOTED' ? 'green' : 'neutral'}>{nice(job.status)}</Badge><ArrowRight size={15}/></div></Link>) : <div className="p-5 text-sm text-muted-foreground">No requests to show.</div>}</div>
        <div className="overflow-hidden rounded-2xl border border-border bg-card"><div className="flex items-center justify-between border-b border-border px-5 py-4"><h3 className="font-semibold">Bookings</h3><span className="text-xs text-muted-foreground">{bookings.data?.length || 0} total</span></div>{bookings.data?.length ? bookings.data.map(b => <Link key={b.id} href={`/bookings/${b.id}`} className="flex items-center justify-between gap-3 border-b border-border/70 px-5 py-4 last:border-0 hover:bg-muted/40" data-testid={`row-booking-${b.id}`}><div className="min-w-0"><div className="truncate font-semibold">{b.providerName}</div><div className="mt-1 text-xs text-muted-foreground">{nice(b.status)} · {date(b.scheduledAt)}</div></div><ArrowRight size={15}/></Link>) : <div className="p-5 text-sm text-muted-foreground">No bookings yet.</div>}</div>
      </div>}
  </section>;
}

function ProviderCard({ provider }: { provider: Provider }) {
  return <article className="rounded-2xl border border-border bg-card p-5 transition hover:-translate-y-0.5 hover:shadow-md" data-testid={`card-provider-${provider.id}`}>
    <div className="flex items-start justify-between gap-3"><div className="flex size-11 items-center justify-center rounded-xl bg-secondary text-lg font-bold text-secondary-foreground">{provider.companyName?.slice(0, 1)}</div>{provider.isDemo && <Badge tone="demo">Demo profile</Badge>}</div>
    <h3 className="mt-4 text-[17px] font-bold">{provider.companyName}</h3><p className="mt-2 line-clamp-2 min-h-10 text-sm leading-5 text-muted-foreground">{provider.description}</p>
    <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground"><MapPin size={14}/>{provider.city}, {provider.countryCode}</div>
    <div className="mt-4 flex items-center justify-between border-t border-border pt-4 text-xs">
      <span className="flex items-center gap-1.5">{provider.verificationStatus === 'VERIFIED' ? <><BadgeCheck size={15} className="text-primary"/>Verified</> : <Badge>{nice(provider.verificationStatus)}</Badge>}</span>
      <span>{provider.averageRating != null ? `${provider.averageRating} · ${provider.reviewCount} reviews` : 'No rating data'}</span>
    </div>
    <div className="mt-4 text-sm font-semibold">{provider.minimumPrice != null || provider.maximumPrice != null ? `${provider.minimumPrice != null ? money(provider.minimumPrice, provider.currency) : '—'} – ${provider.maximumPrice != null ? money(provider.maximumPrice, provider.currency) : '—'}` : 'Price not listed'} <span className="font-normal text-muted-foreground">indicative range</span></div>
    <Link href={`/providers/${provider.id}`} className="mt-4 inline-flex items-center gap-2 text-sm font-bold text-primary" data-testid={`link-provider-details-${provider.id}`}>View profile <ArrowRight size={15}/></Link>
  </article>;
}

export function ProviderDetailPage() {
  const { providerId = '' } = useParams<{ providerId: string }>();
  const provider = useGetProvider(providerId);
  return <Shell><PageWrap><Link href="/" className="inline-flex items-center gap-2 text-sm font-semibold text-muted-foreground hover:text-foreground"><ArrowLeft size={16}/> Back to discovery</Link><div className="mx-auto mt-8 max-w-[760px]">
    {provider.isLoading ? <LoadingRows count={2}/> : provider.isError || !provider.data ? <ErrorNote message="This provider profile could not be retrieved." onRetry={() => void provider.refetch()}/> : <article className="rounded-2xl border border-border bg-card p-6 md:p-9" data-testid={`panel-provider-${provider.data.id}`}><div className="flex flex-wrap items-start justify-between gap-4"><div className="flex items-center gap-4"><div className="grid size-14 place-items-center rounded-2xl bg-secondary text-2xl font-bold">{provider.data.companyName.slice(0, 1)}</div><div><div className="text-[11px] font-bold uppercase tracking-[.15em] text-primary">Provider profile</div><h1 className="serif mt-1 text-3xl font-bold">{provider.data.companyName}</h1></div></div>{provider.data.isDemo && <Badge tone="demo">Demo profile</Badge>}</div><p className="mt-6 whitespace-pre-wrap text-sm leading-7 text-muted-foreground">{provider.data.description}</p><div className="mt-6 grid gap-4 border-y border-border py-5 sm:grid-cols-2"><div><span className="text-xs text-muted-foreground">Based in</span><p className="mt-1 flex items-center gap-1.5 font-semibold"><MapPin size={15}/>{provider.data.city}, {provider.data.countryCode}</p></div><div><span className="text-xs text-muted-foreground">Verification</span><p className="mt-1 flex items-center gap-1.5 font-semibold">{provider.data.verificationStatus === 'VERIFIED' && <BadgeCheck size={15} className="text-primary"/>}{nice(provider.data.verificationStatus)}</p></div><div><span className="text-xs text-muted-foreground">Rating data</span><p className="mt-1 font-semibold">{provider.data.averageRating != null ? `${provider.data.averageRating} · ${provider.data.reviewCount} reviews` : 'Not provided'}</p></div><div><span className="text-xs text-muted-foreground">Indicative price range</span><p className="mt-1 font-semibold">{provider.data.minimumPrice != null || provider.data.maximumPrice != null ? `${provider.data.minimumPrice != null ? money(provider.data.minimumPrice, provider.data.currency) : '—'} – ${provider.data.maximumPrice != null ? money(provider.data.maximumPrice, provider.data.currency) : '—'}` : 'Not provided'}</p></div></div><div className="mt-5"><span className="text-xs text-muted-foreground">Services</span><div className="mt-2 flex flex-wrap gap-2">{provider.data.serviceSlugs.map(slug => <Badge key={slug}>{slug}</Badge>)}</div></div><Link href="/" className="mt-7 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground" data-testid="link-find-this-service">Create a service request <ArrowRight size={15}/></Link></article>}
  </div></PageWrap></Shell>;
}

export function HomePage() {
  const services = useListServices();
  const [serviceSlug, setServiceSlug] = useState('');
  const [city, setCity] = useState('');
  const [countryCode, setCountryCode] = useState('US');
  const [searchParams, setSearchParams] = useState<SearchProvidersParams | undefined>();
  const providers = useSearchProviders(searchParams, { query: { queryKey: getSearchProvidersQueryKey(searchParams), enabled: !!searchParams?.serviceSlug && !!searchParams?.location } });
  const [notice, setNotice] = useState('');
  const [form, setForm] = useState({ serviceSlug: '', description: '', city: '', countryCode: 'US', urgency: 'standard' as JobInput['urgency'], propertyType: 'residential' as JobInput['propertyType'] });
  const createJob = useCreateJob();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const valid = !!form.serviceSlug && form.description.trim().length >= 5 && form.city.trim().length >= 1 && form.countryCode.length === 2;
  const selectServices = services.data || [];
  const onSearch = (e: FormEvent) => { e.preventDefault(); if (!serviceSlug || !city.trim() || countryCode.trim().length !== 2) return; setSearchParams({ serviceSlug, location: `${city.trim()}, ${countryCode.toUpperCase()}`, limit: 8 }); document.getElementById('provider-results')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  const createRequest = (e: FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    const payload: JobInput = { ...form, description: form.description.trim(), city: form.city.trim() };
    createJob.mutate({ data: payload }, {
      onSuccess: async job => {
        await Promise.all([queryClient.invalidateQueries({ queryKey: getListMyJobsQueryKey() }), queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() })]);
        setLocation(`/jobs/${job.id}`);
      },
    });
  };
  return <Shell><PageWrap>
    <section className="relative overflow-hidden rounded-[28px] bg-[#203640] px-6 py-9 text-[#f6f3e8] md:px-12 md:py-14">
      <div className="soft-grid pointer-events-none absolute inset-0 opacity-[.2]"></div>
      <div className="pointer-events-none absolute -right-12 -top-24 size-[380px] rounded-full border border-white/10"></div><div className="pointer-events-none absolute -right-1 top-[-58px] size-[245px] rounded-full border border-white/10"></div>
      <div className="relative max-w-[710px]"><div className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[.07] px-3 py-1.5 text-[11px] font-bold uppercase tracking-[.14em] text-[#a9d6c2]"><Sparkles size={14}/>The right help, without the guesswork</div>
        <h1 className="serif max-w-[690px] text-[clamp(2.6rem,6vw,5rem)] font-extrabold leading-[.99] tracking-[-.065em]">A clear way to<br className="hidden sm:block"/> get things <span className="text-[#a9d6c2]">sorted.</span></h1>
        <p className="mt-5 max-w-[520px] text-[15px] leading-7 text-white/70 md:text-base">Tell us what needs doing. We’ll help you reach local professionals, compare their quotes and keep the booking details in one place.</p>
      </div>
      <form onSubmit={onSearch} className="relative mt-9 grid gap-2 rounded-2xl border border-white/15 bg-[#f9f7f0] p-2 sm:grid-cols-[1.2fr_1fr_1fr_auto]">
        <label className="flex min-w-0 flex-col gap-1 rounded-xl px-3 py-2 text-[10px] font-bold uppercase tracking-[.12em] text-[#617077]">What do you need?
          <select aria-label="Choose a service to search" className="min-w-0 bg-transparent text-sm font-semibold normal-case tracking-normal text-[#203640] outline-none" value={serviceSlug} onChange={e => setServiceSlug(e.target.value)} data-testid="select-search-service"><option value="">{services.isLoading ? 'Loading services…' : 'Select a service'}</option>{selectServices.map(s => <option value={s.slug} key={s.slug}>{s.name}</option>)}</select>
        </label>
        <label className="flex flex-col gap-1 border-t border-[#e6e2d8] px-3 py-2 text-[10px] font-bold uppercase tracking-[.12em] text-[#617077] sm:border-l sm:border-t-0">Your city
          <input aria-label="City for provider search" className="w-full bg-transparent text-sm font-semibold normal-case tracking-normal text-[#203640] outline-none placeholder:text-[#9aa1a1]" placeholder="e.g. Bristol" value={city} onChange={e => setCity(e.target.value)} data-testid="input-search-city"/>
        </label>
        <label className="flex flex-col gap-1 border-t border-[#e6e2d8] px-3 py-2 text-[10px] font-bold uppercase tracking-[.12em] text-[#617077] sm:border-l sm:border-t-0">Country code
          <input aria-label="Country code for provider search" maxLength={2} className="w-full bg-transparent text-sm font-semibold uppercase normal-case tracking-normal text-[#203640] outline-none placeholder:text-[#9aa1a1]" value={countryCode} onChange={e => setCountryCode(e.target.value.toUpperCase())} data-testid="input-search-country" />
        </label>
        <button type="submit" disabled={!serviceSlug || !city.trim() || countryCode.trim().length !== 2} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-primary px-5 text-sm font-bold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50" data-testid="button-search-providers"><Search size={16}/>Find help</button>
      </form>
      <div className="relative mt-4 flex flex-wrap gap-x-5 gap-y-2 text-[11px] text-white/60"><span className="inline-flex items-center gap-1.5"><ShieldCheck size={13}/> Clear request, no guesswork</span><span className="inline-flex items-center gap-1.5"><Globe2 size={13}/> Local professionals</span><span className="inline-flex items-center gap-1.5"><FileText size={13}/> Compare real quotes</span></div>
    </section>
    {searchParams && <section id="provider-results" className="scroll-mt-28 pt-14" data-testid="section-provider-results"><div className="mb-6 flex items-end justify-between gap-4"><div><div className="text-[11px] font-bold uppercase tracking-[.16em] text-primary">Provider search</div><h2 className="serif mt-2 text-3xl font-bold">Local professionals</h2><p className="mt-1 text-sm text-muted-foreground">{selectServices.find(s => s.slug === searchParams.serviceSlug)?.name} near {searchParams.location}</p></div><button className="text-sm font-semibold text-primary underline underline-offset-4" onClick={() => setSearchParams(undefined)} data-testid="button-clear-search">Clear search</button></div>
      {providers.isLoading ? <LoadingRows/> : providers.isError ? <ErrorNote message="Provider search is unavailable." onRetry={() => void providers.refetch()}/> : providers.data?.length ? <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{providers.data.map(p => <ProviderCard provider={p} key={p.id}/>)}</div> : <StatePanel title="No providers found in this search" body="Try a nearby city or a different service. We only show provider information returned by the marketplace."/>}
    </section>}
    <div className="mt-14 grid gap-7 lg:grid-cols-[.72fr_1.28fr]">
      <section className="self-start rounded-2xl border border-border bg-card p-6 md:p-7"><div className="flex items-center gap-3"><span className="grid size-10 place-items-center rounded-xl bg-accent text-primary"><Wrench size={19}/></span><div><div className="text-[10px] font-bold uppercase tracking-[.15em] text-primary">Start with the need</div><h2 className="serif text-xl font-bold">Tell us what’s going on.</h2></div></div>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">A few useful details make it easier to reach the right professionals and get comparable responses.</p>
        <form id="request-form" onSubmit={createRequest} className="mt-6 space-y-4">
          <label className="block text-xs font-semibold">Service <select required className="mt-1.5 h-11 w-full rounded-lg border border-input bg-background px-3 text-sm font-normal outline-none focus:ring-2 focus:ring-ring" value={form.serviceSlug} onChange={e => setForm({ ...form, serviceSlug: e.target.value })} data-testid="select-request-service"><option value="">Choose a service</option>{selectServices.map(s => <option key={s.slug} value={s.slug}>{s.name} · {s.category}</option>)}</select></label>
          {services.isError && <ErrorNote message="Service categories could not be loaded." onRetry={() => void services.refetch()}/>}
          <label className="block text-xs font-semibold">Describe the work <textarea required minLength={5} maxLength={3000} rows={4} className="mt-1.5 w-full resize-y rounded-lg border border-input bg-background px-3 py-2.5 text-sm font-normal leading-5 outline-none focus:ring-2 focus:ring-ring" placeholder="What needs attention? Include any details a professional should know." value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} data-testid="input-request-description"/></label>
          <div className="grid grid-cols-[1.2fr_.8fr] gap-3"><label className="block text-xs font-semibold">City<input required maxLength={120} className="mt-1.5 h-11 w-full rounded-lg border border-input bg-background px-3 text-sm font-normal outline-none focus:ring-2 focus:ring-ring" placeholder="City" value={form.city} onChange={e => setForm({ ...form, city: e.target.value })} data-testid="input-request-city"/></label><label className="block text-xs font-semibold">Country code<input required minLength={2} maxLength={2} className="mt-1.5 h-11 w-full rounded-lg border border-input bg-background px-3 text-sm font-normal uppercase outline-none focus:ring-2 focus:ring-ring" placeholder="US" value={form.countryCode} onChange={e => setForm({ ...form, countryCode: e.target.value.toUpperCase() })} data-testid="input-request-country"/></label></div>
          <div className="grid grid-cols-2 gap-3"><label className="block text-xs font-semibold">Timing<select className="mt-1.5 h-11 w-full rounded-lg border border-input bg-background px-3 text-sm font-normal outline-none" value={form.urgency} onChange={e => setForm({ ...form, urgency: e.target.value as JobInput['urgency'] })} data-testid="select-request-urgency"><option value="standard">Standard</option><option value="urgent">Urgent</option><option value="emergency">Emergency</option><option value="unknown">Not sure</option></select></label><label className="block text-xs font-semibold">Property<select className="mt-1.5 h-11 w-full rounded-lg border border-input bg-background px-3 text-sm font-normal outline-none" value={form.propertyType} onChange={e => setForm({ ...form, propertyType: e.target.value as JobInput['propertyType'] })} data-testid="select-property-type"><option value="residential">Residential</option><option value="commercial">Commercial</option><option value="unknown">Not sure</option></select></label></div>
          {createJob.isError && <ErrorNote message="Your request was not created. Check the details and try again."/>}
          <button disabled={!valid || createJob.isPending} type="submit" className="flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-bold text-primary-foreground transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-55" data-testid="button-create-request">{createJob.isPending ? 'Creating request…' : <>Create my request <ArrowRight size={16}/></>}</button>
          <div className="text-center text-[11px] leading-5 text-muted-foreground">You’ll review matched responses before making a decision.</div>
        </form>
      </section>
      <div className="space-y-8">
        <ShowActivity/>
        <section id="how-it-works" className="rounded-2xl border border-border bg-[#e9eee8] p-6 md:p-8"><div className="text-[11px] font-bold uppercase tracking-[.15em] text-primary">A simpler route to getting it done</div><h2 className="serif mt-2 max-w-lg text-2xl font-bold tracking-tight md:text-3xl">From “who do I call?” to a booking you can rely on.</h2><div className="mt-6 grid gap-5 sm:grid-cols-3">
          {[['01','Describe the job','Share the service, location and details that matter.'],['02','Compare replies','See provider quotes together, with costs and terms clear.'],['03','Choose with confidence','Accept a quote and keep the booking status close at hand.']].map(([n,t,b]) => <div key={n} className="border-t border-[#bfcfc2] pt-4"><span className="mono text-xs font-bold text-primary">{n}</span><h3 className="mt-3 font-bold">{t}</h3><p className="mt-1 text-sm leading-5 text-muted-foreground">{b}</p></div>)}
        </div></section>
        <section className="flex flex-col items-start justify-between gap-5 rounded-2xl bg-secondary px-6 py-6 sm:flex-row sm:items-center md:px-8"><div><div className="text-[10px] font-bold uppercase tracking-[.15em] text-primary">For local businesses</div><h2 className="serif mt-1 text-xl font-bold">Meet customers with work that fits.</h2><p className="mt-1 max-w-md text-sm text-muted-foreground">Build a profile and respond to matched service requests with a quote.</p></div><Link href="/provider" className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-border bg-card px-4 py-2.5 text-sm font-bold hover:bg-background" data-testid="link-join-provider">Join Sentin <ArrowRight size={15}/></Link></section>
      </div>
    </div>
    <div className="mt-14 flex items-center justify-between border-t border-border pt-6 text-xs text-muted-foreground"><span>Built around transparent service requests.</span><span className="flex items-center gap-1.5"><ShieldCheck size={14} className="text-primary"/>You decide who to hire.</span></div>
  </PageWrap></Shell>;
}
function ShowActivity() {
  const { isLoaded, isSignedIn } = useUser();
  if (!isLoaded) return <div className="h-28 animate-pulse rounded-2xl bg-muted"/>;
  if (!isSignedIn) return <section className="rounded-2xl border border-border bg-card p-6"><div className="flex gap-4"><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent text-primary"><BriefcaseBusiness size={18}/></span><div><div className="text-[10px] font-bold uppercase tracking-[.15em] text-primary">Personal service dashboard</div><h2 className="serif mt-1 text-xl font-bold">Keep your requests in one place.</h2><p className="mt-1 max-w-lg text-sm leading-6 text-muted-foreground">Sign in to follow provider replies, compare quotes and find your booking records whenever you need them.</p><Link href="/sign-up" className="mt-4 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground" data-testid="link-sign-up-activity">Create an account <ArrowRight size={15}/></Link></div></div></section>;
  return <Dashboard/>;
}

export function JobPage() {
  const { jobId = '' } = useParams<{ jobId: string }>();
  const job = useGetJob(jobId);
  const quotes = useListJobQuotes(jobId);
  const requestQuotes = useRequestQuotes();
  const acceptQuote = useAcceptQuote();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const [message, setMessage] = useState('');
  const request = () => requestQuotes.mutate({ jobId }, { onSuccess: async updated => { await Promise.all([queryClient.invalidateQueries({ queryKey: getGetJobQueryKey(jobId) }), queryClient.invalidateQueries({ queryKey: getListJobQuotesQueryKey(jobId) }), queryClient.invalidateQueries({ queryKey: getListMyJobsQueryKey() }), queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() })]); setMessage(updated.matchedProviderCount ? 'Your request has been sent to matched professionals.' : 'Your request was updated. We’ll show any provider replies here.'); } });
  const chooseQuote = (quoteId: string) => acceptQuote.mutate({ quoteId }, { onSuccess: async booking => { await Promise.all([queryClient.invalidateQueries({ queryKey: getListJobQuotesQueryKey(jobId) }), queryClient.invalidateQueries({ queryKey: getGetJobQueryKey(jobId) }), queryClient.invalidateQueries({ queryKey: getListMyBookingsQueryKey() }), queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() })]); setLocation(`/bookings/${booking.id}`); } });
  return <Shell><PageWrap><Link href="/" className="inline-flex items-center gap-2 text-sm font-semibold text-muted-foreground hover:text-foreground"><ArrowLeft size={16}/> Back to Sentin</Link>
    {job.isLoading ? <div className="mt-8"><LoadingRows count={3}/></div> : job.isError || !job.data ? <div className="mt-8"><ErrorNote message="This request could not be retrieved." onRetry={() => void job.refetch()}/></div> : <div className="mt-7 grid gap-8 lg:grid-cols-[.86fr_1.14fr]">
      <section className="h-fit rounded-2xl border border-border bg-card p-6 md:p-8" data-testid={`panel-job-${job.data.id}`}><div className="flex items-center justify-between gap-3"><Badge tone={job.data.status === 'QUOTED' || job.data.status === 'OPEN' ? 'green' : 'neutral'}>{nice(job.data.status)}</Badge><span className="text-xs text-muted-foreground">Request · {job.data.id}</span></div><div className="mt-6 text-[11px] font-bold uppercase tracking-[.16em] text-primary">Service request</div><h1 className="serif mt-2 text-3xl font-bold tracking-tight">{job.data.serviceName}</h1><p className="mt-4 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">{job.data.description}</p><div className="mt-6 grid grid-cols-2 gap-3 border-y border-border py-5 text-sm"><div><span className="text-xs text-muted-foreground">Location</span><p className="mt-1 flex items-center gap-1.5 font-semibold"><MapPin size={14}/>{job.data.city}, {job.data.countryCode}</p></div><div><span className="text-xs text-muted-foreground">Submitted</span><p className="mt-1 font-semibold">{date(job.data.createdAt)}</p></div><div><span className="text-xs text-muted-foreground">Timing</span><p className="mt-1 font-semibold">{nice(job.data.urgency)}</p></div><div><span className="text-xs text-muted-foreground">Property</span><p className="mt-1 font-semibold">{nice(job.data.propertyType)}</p></div></div><p className="mt-4 text-xs text-muted-foreground">{job.data.matchedProviderCount} matched {job.data.matchedProviderCount === 1 ? 'professional' : 'professionals'}</p>
        {job.data.status === 'DRAFT' || job.data.status === 'OPEN' ? <button onClick={request} disabled={requestQuotes.isPending} className="mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-bold text-primary-foreground disabled:opacity-50" data-testid="button-request-quotes">{requestQuotes.isPending ? 'Sending request…' : 'Request quotes from matches'} <ArrowRight size={16}/></button> : null}
        {requestQuotes.isError && <div className="mt-3"><ErrorNote message="We couldn’t send the request to providers."/></div>}{message && <p role="status" className="mt-3 text-sm text-primary" data-testid="status-request-sent">{message}</p>}
      </section>
      <section><div className="mb-5 flex items-end justify-between"><div><div className="text-[11px] font-bold uppercase tracking-[.16em] text-primary">Provider responses</div><h2 className="serif mt-2 text-3xl font-bold">Compare quotes</h2></div><span className="text-sm text-muted-foreground">{quotes.data?.length ?? 0} received</span></div>
        {quotes.isLoading ? <LoadingRows/> : quotes.isError ? <ErrorNote message="Provider quotes could not be loaded." onRetry={() => void quotes.refetch()}/> : quotes.data?.length ? <div className="space-y-4">{quotes.data.map(q => <article className="rounded-2xl border border-border bg-card p-5 md:p-6" key={q.id} data-testid={`card-quote-${q.id}`}><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-lg font-bold">{q.providerName}</h3><div className="mt-1 text-xs text-muted-foreground">Sent {date(q.createdAt)}</div></div><div className="text-right"><div className="serif text-2xl font-bold">{money(q.amount, q.currency)}</div><Badge tone={q.status === 'SENT' ? 'green' : 'neutral'}>{nice(q.status)}</Badge></div></div>{q.isDemo && <div className="mt-4"><Badge tone="demo">Synthetic quote · demo</Badge></div>}<p className="mt-4 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">{q.description}</p><div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground">{q.durationMinutes != null && <span className="flex items-center gap-1.5"><Clock3 size={14}/>{q.durationMinutes} min estimated</span>}{q.expiresAt && <span className="flex items-center gap-1.5"><CalendarDays size={14}/>Expires {date(q.expiresAt)}</span>}</div>{q.status === 'SENT' && <button onClick={() => chooseQuote(q.id)} disabled={acceptQuote.isPending} className="mt-5 inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-bold text-primary-foreground disabled:opacity-50" data-testid={`button-accept-quote-${q.id}`}>{acceptQuote.isPending ? 'Accepting…' : 'Accept this quote'} <ArrowRight size={15}/></button>}</article>)}</div> : <StatePanel title="No quotes just yet" body="Request quotes to send your service details to matched professionals. Their real responses will appear here for an easy comparison." action={<button onClick={request} disabled={requestQuotes.isPending || job.data.status === 'BOOKED' || job.data.status === 'COMPLETED'} className="rounded-lg bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground disabled:opacity-50" data-testid="button-request-quotes-empty">{requestQuotes.isPending ? 'Sending…' : 'Request quotes'}</button>}/>}
        {acceptQuote.isError && <div className="mt-4"><ErrorNote message="That quote could not be accepted. Please try again."/></div>}</section>
    </div>}
    {job.data && <div className="mt-8"><JobMessagesPanel jobId={jobId}/></div>}
  </PageWrap></Shell>;
}

function JobMessagesPanel({ jobId, jobLabel, collapsible = false }: { jobId: string; jobLabel?: string; collapsible?: boolean }) {
  const { user } = useUser();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(!collapsible);
  const [body, setBody] = useState('');
  const messages = useListJobMessages(jobId, {
    query: { queryKey: getListJobMessagesQueryKey(jobId), enabled: open, refetchInterval: open ? 10_000 : false },
  });
  const send = useSendJobMessage();
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = body.trim();
    if (!trimmed || send.isPending) return;
    send.mutate({ jobId, data: { body: trimmed } }, {
      onSuccess: async () => {
        setBody('');
        await queryClient.invalidateQueries({ queryKey: getListJobMessagesQueryKey(jobId) });
      },
    });
  };

  return <section className="rounded-2xl border border-border bg-card p-5 md:p-6" data-testid={`panel-job-messages-${jobId}`}>
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-2"><MessageCircle size={17} className="text-primary"/><div><h2 className="font-bold">{jobLabel ? `Messages · ${jobLabel}` : 'Request messages'}</h2>{jobLabel && <p className="mt-0.5 text-xs text-muted-foreground">Request · {jobId}</p>}</div></div>
      {collapsible && <button type="button" aria-expanded={open} onClick={() => setOpen(value => !value)} className="text-sm font-semibold text-primary underline underline-offset-4" data-testid={`button-toggle-messages-${jobId}`}>{open ? 'Hide' : 'View conversation'}</button>}
    </div>
    {open && <>
      <div className="mt-4 max-h-72 space-y-3 overflow-y-auto rounded-xl bg-muted/40 p-3" aria-live="polite">
        {messages.isLoading ? <LoadingRows count={1}/> : messages.isError ? <ErrorNote message="Messages could not be loaded." onRetry={() => void messages.refetch()}/> : messages.data?.length ? messages.data.map(item => <article key={item.id} className={`max-w-[92%] rounded-xl px-3.5 py-2.5 ${item.senderUserId === user?.id ? 'ml-auto bg-accent text-foreground' : 'bg-card'}`}><div className="mb-1 flex items-center justify-between gap-4 text-[11px] text-muted-foreground"><span className="font-semibold">{item.senderUserId === user?.id ? 'You' : 'Other participant'}</span><time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString()}</time></div><p className="whitespace-pre-wrap break-words text-sm leading-5">{item.body}</p></article>) : <p className="py-4 text-center text-sm text-muted-foreground">No messages yet. Keep request details and coordination here.</p>}
      </div>
      <form onSubmit={submit} className="mt-3 flex items-end gap-2">
        <label className="sr-only" htmlFor={`message-${jobId}`}>Write a message</label>
        <textarea id={`message-${jobId}`} value={body} onChange={event => setBody(event.target.value)} maxLength={2000} rows={2} placeholder="Write a message to the other participant…" className="min-h-11 flex-1 resize-y rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring" data-testid={`input-message-${jobId}`}/>
        <button type="submit" disabled={!body.trim() || send.isPending} className="inline-flex h-11 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-bold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50" data-testid={`button-send-message-${jobId}`}><Send size={15}/><span className="hidden sm:inline">{send.isPending ? 'Sending…' : 'Send'}</span></button>
      </form>
      {send.isError && <div className="mt-3"><ErrorNote message="Your message was not sent. Please try again."/></div>}
    </>}
  </section>;
}

function BookingTimeline({ booking }: { booking: Booking }) {
  return <div className="rounded-2xl border border-border bg-card p-6 md:p-8" data-testid={`panel-booking-${booking.id}`}><div className="flex flex-wrap items-start justify-between gap-4"><div><div className="text-[11px] font-bold uppercase tracking-[.15em] text-primary">Booking record</div><h1 className="serif mt-2 text-3xl font-bold">{booking.providerName}</h1><p className="mt-1 text-sm text-muted-foreground">Booking reference · {booking.id}</p></div><Badge tone={['CONFIRMED','EN_ROUTE','ARRIVED','IN_PROGRESS','COMPLETED'].includes(booking.status) ? 'green' : booking.status === 'DISPUTED' ? 'amber' : 'neutral'}>{nice(booking.status)}</Badge></div>
    <div className="mt-7 grid gap-4 border-y border-border py-5 sm:grid-cols-3"><div><span className="text-xs text-muted-foreground">Created</span><p className="mt-1 font-semibold">{date(booking.createdAt)}</p></div><div><span className="text-xs text-muted-foreground">Scheduled</span><p className="mt-1 font-semibold">{booking.scheduledAt ? new Date(booking.scheduledAt).toLocaleString() : 'Not scheduled'}</p></div><div><span className="text-xs text-muted-foreground">Request</span><p className="mt-1 truncate font-semibold">{booking.jobId}</p></div></div>
    <div className="mt-6 rounded-xl bg-accent/70 p-4"><div className="flex items-start gap-3"><Check size={18} className="mt-0.5 shrink-0 text-primary"/><div><h2 className="font-semibold">Status from the marketplace</h2><p className="mt-1 text-sm leading-6 text-muted-foreground">This record reflects the latest booking status returned by Sentin. Follow up with the provider directly for arrangements not shown here.</p></div></div></div>
    {booking.statusHistory?.length ? <section className="mt-6"><h2 className="font-semibold">Status history</h2><ol className="mt-3 space-y-3 border-l border-border pl-4">{booking.statusHistory.map(item => <li key={item.id} className="relative"><span className="absolute -left-[21px] top-1.5 size-2.5 rounded-full bg-primary"/><div className="flex flex-wrap items-center justify-between gap-2"><span className="text-sm font-semibold">{item.fromStatus ? `${nice(item.fromStatus)} → ` : ''}{nice(item.toStatus)}</span><time className="text-xs text-muted-foreground">{new Date(item.createdAt).toLocaleString()}</time></div>{item.note && <p className="mt-1 text-xs leading-5 text-muted-foreground">{item.note}</p>}</li>)}</ol></section> : null}
    <Link href={`/jobs/${booking.jobId}`} className="mt-6 inline-flex items-center gap-2 text-sm font-bold text-primary" data-testid="link-booking-request">View original request <ArrowRight size={15}/></Link>
  </div>;
}

function BookingWorkflowControls({ booking }: { booking: Booking }) {
  const queryClient = useQueryClient();
  const customerBookings = useListMyBookings();
  const providerBookings = useListProviderBookings();
  const isCustomer = customerBookings.data?.some(item => item.id === booking.id) ?? false;
  const isProvider = providerBookings.data?.some(item => item.id === booking.id) ?? false;
  const availability = useListProviderAvailability({ query: { queryKey: getListProviderAvailabilityQueryKey(), enabled: isProvider } });
  const update = useUpdateBookingStatus();
  const [slotId, setSlotId] = useState('');
  const isPending = customerBookings.isLoading || providerBookings.isLoading;
  const canCancel = ['REQUESTED', 'PENDING_PROVIDER', 'CONFIRMED', 'EN_ROUTE'].includes(booking.status);
  const providerNext: Record<string, { status: 'EN_ROUTE' | 'ARRIVED' | 'IN_PROGRESS' | 'COMPLETED'; label: string }> = {
    CONFIRMED: { status: 'EN_ROUTE', label: 'Mark provider en route' },
    EN_ROUTE: { status: 'ARRIVED', label: 'Mark arrived' },
    ARRIVED: { status: 'IN_PROGRESS', label: 'Start work' },
    IN_PROGRESS: { status: 'COMPLETED', label: 'Mark completed' },
  };
  const advance = (status: 'CONFIRMED' | 'EN_ROUTE' | 'ARRIVED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' | 'DISPUTED') => {
    update.mutate({ bookingId: booking.id, data: { status, ...(status === 'CONFIRMED' ? { availabilitySlotId: slotId } : {}) } }, {
      onSuccess: async () => {
        setSlotId('');
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: getGetBookingQueryKey(booking.id) }),
          queryClient.invalidateQueries({ queryKey: getListMyBookingsQueryKey() }),
          queryClient.invalidateQueries({ queryKey: getListProviderBookingsQueryKey() }),
          queryClient.invalidateQueries({ queryKey: getListProviderRequestsQueryKey() }),
          queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() }),
        ]);
      },
    });
  };
  const openSlots = (availability.data ?? []).filter(slot => slot.status === 'OPEN');
  const needsConfirmation = isProvider && ['REQUESTED', 'PENDING_PROVIDER'].includes(booking.status);
  const next = providerNext[booking.status];

  if (isPending) return <div className="mt-5"><LoadingRows count={1}/></div>;
  if (!isCustomer && !isProvider) return null;

  return <section className="mt-5 rounded-2xl border border-border bg-card p-5" data-testid={`panel-booking-actions-${booking.id}`}>
    <h2 className="font-bold">Booking actions</h2>
    {needsConfirmation && <label className="mt-3 block text-xs font-semibold">Choose an open appointment slot
      <select value={slotId} onChange={event => setSlotId(event.target.value)} className="mt-1.5 h-11 w-full rounded-lg border border-input bg-background px-3 text-sm font-normal" data-testid="select-booking-slot">
        <option value="">Select a real published slot</option>{openSlots.map(slot => <option key={slot.id} value={slot.id}>{new Date(slot.startsAt).toLocaleString()} – {new Date(slot.endsAt).toLocaleTimeString()}</option>)}
      </select>
    </label>}
    {needsConfirmation && availability.isError && <div className="mt-3"><ErrorNote message="Your published availability could not be loaded." onRetry={() => void availability.refetch()}/></div>}
    {needsConfirmation && !availability.isError && openSlots.length === 0 && <p className="mt-3 text-sm text-muted-foreground">Publish an open slot before confirming this booking.</p>}
    <div className="mt-4 flex flex-wrap gap-2">
      {needsConfirmation && <button type="button" onClick={() => advance('CONFIRMED')} disabled={!slotId || update.isPending} className="rounded-lg bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground disabled:opacity-50" data-testid="button-confirm-booking">{update.isPending ? 'Saving…' : 'Confirm selected time'}</button>}
      {isProvider && next && <button type="button" onClick={() => advance(next.status)} disabled={update.isPending} className="rounded-lg bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground disabled:opacity-50">{next.label}</button>}
      {isCustomer && ['IN_PROGRESS', 'COMPLETED'].includes(booking.status) && <button type="button" onClick={() => advance('DISPUTED')} disabled={update.isPending} className="rounded-lg border border-amber-300 px-4 py-2.5 text-sm font-bold text-amber-800 disabled:opacity-50">Report an issue</button>}
      {(isCustomer || isProvider) && canCancel && <button type="button" onClick={() => advance('CANCELLED')} disabled={update.isPending} className="rounded-lg border border-border px-4 py-2.5 text-sm font-semibold disabled:opacity-50">Cancel booking</button>}
    </div>
    {update.isError && <div className="mt-3"><ErrorNote message="That booking update could not be saved. Refresh the record and try again."/></div>}
  </section>;
}

export function BookingPage() {
  const { bookingId = '' } = useParams<{ bookingId: string }>();
  const booking = useGetBooking(bookingId);
  return <Shell><PageWrap><Link href="/" className="inline-flex items-center gap-2 text-sm font-semibold text-muted-foreground hover:text-foreground"><ArrowLeft size={16}/> Back to Sentin</Link><div className="mx-auto mt-9 max-w-[760px]">{booking.isLoading ? <LoadingRows count={2}/> : booking.isError || !booking.data ? <ErrorNote message="We couldn’t retrieve this booking record. Check the reference and try again." onRetry={() => void booking.refetch()}/> : <><BookingTimeline booking={booking.data}/><BookingWorkflowControls booking={booking.data}/></>}</div></PageWrap></Shell>;
}

function ProviderOnboarding() {
  const services = useListServices();
  const createProfile = useCreateProviderProfile();
  const { user } = useUser();
  const queryClient = useQueryClient();
  const storageKey = user?.id ? `sentin-provider-profile:${user.id}` : null;
  const [profileId, setProfileId] = useState<string | null>(() => storageKey && typeof window !== 'undefined' ? window.localStorage.getItem(storageKey) : null);
  const ownProfile = useGetProvider(profileId || '', { query: { enabled: !!profileId, queryKey: getGetProviderQueryKey(profileId || '') } });
  const [form, setForm] = useState({ companyName: '', description: '', serviceSlugs: [] as string[], city: '', countryCode: 'US', currency: 'USD', minimumPrice: '', maximumPrice: '' });
  const toggle = (slug: string) => setForm(old => ({ ...old, serviceSlugs: old.serviceSlugs.includes(slug) ? old.serviceSlugs.filter(v => v !== slug) : [...old.serviceSlugs, slug] }));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const data: ProviderProfileInput = { companyName: form.companyName.trim(), description: form.description.trim(), serviceSlugs: form.serviceSlugs, city: form.city.trim(), countryCode: form.countryCode, currency: form.currency.toUpperCase(), minimumPrice: form.minimumPrice === '' ? null : Number(form.minimumPrice), maximumPrice: form.maximumPrice === '' ? null : Number(form.maximumPrice) };
    createProfile.mutate({ data }, { onSuccess: async provider => { if (storageKey) window.localStorage.setItem(storageKey, provider.id); setProfileId(provider.id); await queryClient.invalidateQueries({ queryKey: getSearchProvidersQueryKey() }); await queryClient.invalidateQueries({ queryKey: getListProviderRequestsQueryKey() }); } });
  };
  return <section className="rounded-2xl border border-border bg-card p-6 md:p-8"><div className="flex items-start gap-4"><span className="grid size-11 shrink-0 place-items-center rounded-xl bg-accent text-primary"><BriefcaseBusiness size={20}/></span><div><div className="text-[11px] font-bold uppercase tracking-[.15em] text-primary">Provider profile</div><h2 className="serif mt-1 text-2xl font-bold">Introduce your business.</h2><p className="mt-1 text-sm leading-6 text-muted-foreground">Add details you’re comfortable sharing so Sentin can match relevant requests.</p></div></div>
    {profileId && ownProfile.isLoading ? <div className="mt-6"><LoadingRows count={2}/></div> : profileId && ownProfile.data ? <div className="mt-6 rounded-xl border border-primary/20 bg-accent p-4" data-testid="status-provider-profile"><div className="flex items-center gap-2 font-semibold"><Check size={17} className="text-primary"/> Profile on Sentin · {ownProfile.data.companyName}</div><p className="mt-2 text-sm text-muted-foreground">{ownProfile.data.city}, {ownProfile.data.countryCode} · {ownProfile.data.serviceSlugs.length} listed services · {nice(ownProfile.data.verificationStatus)}</p><p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-foreground/80">{ownProfile.data.description}</p>{ownProfile.data.isDemo && <div className="mt-3"><Badge tone="demo">Demo profile</Badge></div>}</div> : profileId && ownProfile.isError ? <div className="mt-6"><ErrorNote message="Your saved provider profile could not be retrieved." onRetry={() => void ownProfile.refetch()}/></div> : <form onSubmit={submit} className="mt-6 space-y-4">
      <label className="block text-xs font-semibold">Business name<input required minLength={2} maxLength={160} value={form.companyName} onChange={e => setForm({ ...form, companyName: e.target.value })} className="mt-1.5 h-11 w-full rounded-lg border border-input bg-background px-3 text-sm font-normal" data-testid="input-provider-company"/></label>
      <label className="block text-xs font-semibold">About your work<textarea required minLength={20} maxLength={3000} rows={4} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} className="mt-1.5 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm font-normal" placeholder="Describe the services your business provides." data-testid="input-provider-description"/></label>
      <fieldset><legend className="text-xs font-semibold">Services you provide</legend>{services.isLoading ? <div className="mt-2"><LoadingRows count={1}/></div> : services.isError ? <div className="mt-2"><ErrorNote message="Available services could not be loaded." onRetry={() => void services.refetch()}/></div> : <div className="mt-2 flex flex-wrap gap-2">{(services.data || []).map(s => <label key={s.slug} className={`cursor-pointer rounded-full border px-3 py-2 text-xs font-semibold transition ${form.serviceSlugs.includes(s.slug) ? 'border-primary bg-accent text-primary' : 'border-border bg-background text-muted-foreground'}`}><input type="checkbox" className="sr-only" checked={form.serviceSlugs.includes(s.slug)} onChange={() => toggle(s.slug)} data-testid={`checkbox-provider-service-${s.slug}`}/>{s.name}</label>)}</div>}</fieldset>
      <div className="grid gap-3 sm:grid-cols-2"><label className="block text-xs font-semibold">City<input required maxLength={120} value={form.city} onChange={e => setForm({ ...form, city: e.target.value })} className="mt-1.5 h-11 w-full rounded-lg border border-input bg-background px-3 text-sm font-normal" data-testid="input-provider-city"/></label><label className="block text-xs font-semibold">Country code<input required minLength={2} maxLength={2} value={form.countryCode} onChange={e => setForm({ ...form, countryCode: e.target.value.toUpperCase() })} className="mt-1.5 h-11 w-full rounded-lg border border-input bg-background px-3 text-sm font-normal uppercase" data-testid="input-provider-country" placeholder="US"/></label></div>
      <div className="grid gap-3 sm:grid-cols-3"><label className="block text-xs font-semibold">Currency<input required minLength={3} maxLength={3} value={form.currency} onChange={e => setForm({ ...form, currency: e.target.value.toUpperCase() })} className="mt-1.5 h-11 w-full rounded-lg border border-input bg-background px-3 text-sm font-normal uppercase" data-testid="input-provider-currency"/></label><label className="block text-xs font-semibold">Minimum price (optional)<input type="number" min="0" step="0.01" value={form.minimumPrice} onChange={e => setForm({ ...form, minimumPrice: e.target.value })} className="mt-1.5 h-11 w-full rounded-lg border border-input bg-background px-3 text-sm font-normal" data-testid="input-provider-minimum"/></label><label className="block text-xs font-semibold">Maximum price (optional)<input type="number" min="0" step="0.01" value={form.maximumPrice} onChange={e => setForm({ ...form, maximumPrice: e.target.value })} className="mt-1.5 h-11 w-full rounded-lg border border-input bg-background px-3 text-sm font-normal" data-testid="input-provider-maximum"/></label></div>
      {createProfile.isError && <ErrorNote message="Your provider profile could not be saved."/>}
      <button type="submit" disabled={createProfile.isPending || form.serviceSlugs.length === 0} className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-bold text-primary-foreground disabled:opacity-50" data-testid="button-create-provider-profile">{createProfile.isPending ? 'Saving profile…' : 'Save provider profile'} <ArrowRight size={15}/></button>
    </form>}
    {profileId && ownProfile.data && <><ProviderAvailabilityManager providerId={profileId}/><ProviderBookingList/></>}
  </section>;
}

function ProviderAvailabilityManager({ providerId }: { providerId: string }) {
  const queryClient = useQueryClient();
  const slots = useListProviderAvailability();
  const create = useCreateProviderAvailability();
  const update = useUpdateProviderAvailability();
  const [form, setForm] = useState({ startsAt: '', endsAt: '' });
  const localNow = new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  const validRange = form.startsAt && form.endsAt
    && new Date(form.startsAt).getTime() > Date.now()
    && new Date(form.endsAt).getTime() > new Date(form.startsAt).getTime();
  const refreshAvailability = async () => Promise.all([
    queryClient.invalidateQueries({ queryKey: getListProviderAvailabilityQueryKey() }),
    queryClient.invalidateQueries({ queryKey: getListPublicProviderAvailabilityQueryKey(providerId) }),
  ]);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!validRange) return;
    create.mutate({
      data: {
        startsAt: new Date(form.startsAt).toISOString(),
        endsAt: new Date(form.endsAt).toISOString(),
      },
    }, {
      onSuccess: async () => {
        setForm({ startsAt: '', endsAt: '' });
        await refreshAvailability();
      },
    });
  };
  const toggleSlot = (slotId: string, status: 'OPEN' | 'BLOCKED') => update.mutate(
    { slotId, data: { status } },
    { onSuccess: refreshAvailability },
  );

  return <section className="mt-5 rounded-2xl border border-border bg-card p-5" data-testid="section-provider-availability">
    <div className="flex items-start gap-3"><CalendarDays size={18} className="mt-0.5 text-primary"/><div><h3 className="font-bold">Published availability</h3><p className="mt-1 text-sm leading-5 text-muted-foreground">Only open time slots can be offered to customers. Reserved slots come from confirmed bookings.</p></div></div>
    <form onSubmit={submit} className="mt-4 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
      <label className="block text-xs font-semibold">Starts
        <input required type="datetime-local" min={localNow} value={form.startsAt} onChange={event => setForm(value => ({ ...value, startsAt: event.target.value }))} className="mt-1.5 h-10 w-full rounded-lg border border-input bg-background px-2 text-sm font-normal" data-testid="input-availability-start"/>
      </label>
      <label className="block text-xs font-semibold">Ends
        <input required type="datetime-local" min={form.startsAt || localNow} value={form.endsAt} onChange={event => setForm(value => ({ ...value, endsAt: event.target.value }))} className="mt-1.5 h-10 w-full rounded-lg border border-input bg-background px-2 text-sm font-normal" data-testid="input-availability-end"/>
      </label>
      <button type="submit" disabled={!validRange || create.isPending} className="h-10 rounded-lg bg-primary px-4 text-sm font-bold text-primary-foreground disabled:opacity-50" data-testid="button-publish-availability">{create.isPending ? 'Publishing…' : 'Publish slot'}</button>
    </form>
    {create.isError && <div className="mt-3"><ErrorNote message="That slot could not be published. Check that it is in the future and does not overlap another slot."/></div>}
    {slots.isLoading ? <div className="mt-4"><LoadingRows count={1}/></div> : slots.isError ? <div className="mt-4"><ErrorNote message="Published availability could not be loaded." onRetry={() => void slots.refetch()}/></div> : slots.data?.length ? <ul className="mt-4 divide-y divide-border rounded-xl border border-border">{slots.data.map(slot => <li key={slot.id} className="flex flex-wrap items-center justify-between gap-3 p-3" data-testid={`availability-slot-${slot.id}`}><div><div className="text-sm font-semibold">{new Date(slot.startsAt).toLocaleString()} – {new Date(slot.endsAt).toLocaleTimeString()}</div><div className="mt-1 text-xs text-muted-foreground">{nice(slot.status)}</div></div>{slot.status !== 'RESERVED' && <button type="button" onClick={() => toggleSlot(slot.id, slot.status === 'OPEN' ? 'BLOCKED' : 'OPEN')} disabled={update.isPending} className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold disabled:opacity-50" data-testid={`button-toggle-availability-${slot.id}`}>{slot.status === 'OPEN' ? 'Block slot' : 'Reopen slot'}</button>}</li>)}</ul> : <p className="mt-4 rounded-xl border border-dashed border-border p-4 text-center text-sm text-muted-foreground">No upcoming slots are published.</p>}
    {update.isError && <div className="mt-3"><ErrorNote message="The slot status could not be changed."/></div>}
  </section>;
}

function ProviderBookingList() {
  const bookings = useListProviderBookings({ query: { queryKey: getListProviderBookingsQueryKey(), refetchInterval: 10_000 } });
  return <section className="mt-5 rounded-2xl border border-border bg-card p-5" data-testid="section-provider-bookings">
    <div className="flex items-center justify-between gap-3"><div><h3 className="font-bold">Bookings</h3><p className="mt-1 text-sm text-muted-foreground">Review requests and update their real status.</p></div><Badge>{bookings.data?.length ?? 0}</Badge></div>
    {bookings.isLoading ? <div className="mt-4"><LoadingRows count={1}/></div> : bookings.isError ? <div className="mt-4"><ErrorNote message="Provider bookings could not be loaded." onRetry={() => void bookings.refetch()}/></div> : bookings.data?.length ? <ul className="mt-3 divide-y divide-border">{bookings.data.map(booking => <li key={booking.id} className="flex flex-wrap items-center justify-between gap-3 py-3"><div><div className="text-sm font-semibold">{nice(booking.status)}</div><div className="mt-1 text-xs text-muted-foreground">{booking.scheduledAt ? new Date(booking.scheduledAt).toLocaleString() : 'Awaiting provider confirmation'}</div></div><Link href={`/bookings/${booking.id}`} className="text-sm font-semibold text-primary underline underline-offset-4">Manage booking</Link></li>)}</ul> : <p className="mt-3 text-sm text-muted-foreground">No bookings yet.</p>}
  </section>;
}

function QuoteSubmission({ jobId, onDone }: { jobId: string; onDone: () => void }) {
  const submitQuote = useSubmitQuote();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ amount: '', currency: 'USD', description: '', durationMinutes: '' });
  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const data: QuoteInput = { amount: Number(form.amount), currency: form.currency.toUpperCase(), description: form.description.trim(), durationMinutes: form.durationMinutes ? Number(form.durationMinutes) : null };
    submitQuote.mutate({ jobId, data }, { onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: getListProviderRequestsQueryKey() }); await queryClient.invalidateQueries({ queryKey: getListJobQuotesQueryKey(jobId) }); onDone(); } });
  };
  return <form onSubmit={handleSubmit} className="mt-5 grid gap-3 border-t border-border pt-5 sm:grid-cols-2"><label className="block text-xs font-semibold">Quote amount<input type="number" min="0.01" step="0.01" required value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} className="mt-1.5 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm font-normal" data-testid={`input-quote-amount-${jobId}`}/></label><label className="block text-xs font-semibold">Currency<input required minLength={3} maxLength={3} value={form.currency} onChange={e => setForm({ ...form, currency: e.target.value.toUpperCase() })} className="mt-1.5 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm font-normal uppercase" data-testid={`input-quote-currency-${jobId}`}/></label><label className="block text-xs font-semibold sm:col-span-2">What’s included<textarea required minLength={5} maxLength={2000} rows={3} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} className="mt-1.5 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm font-normal" data-testid={`input-quote-description-${jobId}`}/></label><label className="block text-xs font-semibold sm:col-span-2">Estimated duration (minutes, optional)<input type="number" min="1" max="10080" value={form.durationMinutes} onChange={e => setForm({ ...form, durationMinutes: e.target.value })} className="mt-1.5 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm font-normal" data-testid={`input-quote-duration-${jobId}`}/></label>{submitQuote.isError && <div className="sm:col-span-2"><ErrorNote message="Your quote could not be submitted."/></div>}<button disabled={submitQuote.isPending} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-bold text-primary-foreground disabled:opacity-50 sm:col-span-2" data-testid={`button-submit-quote-${jobId}`}>{submitQuote.isPending ? 'Submitting quote…' : 'Submit quote'} <ArrowRight size={15}/></button></form>;
}
export function ProviderPage() {
  const { isLoaded, isSignedIn } = useUser();
  const requests = useListProviderRequests();
  const [quoted, setQuoted] = useState<string[]>([]);
  return <Shell><PageWrap><div className="grid gap-8 lg:grid-cols-[.85fr_1.15fr]">
    <div><div className="mb-5 inline-flex items-center gap-2 rounded-full bg-accent px-3 py-1.5 text-[11px] font-bold uppercase tracking-[.14em] text-primary"><BriefcaseBusiness size={14}/> Sentin for providers</div><h1 className="serif max-w-xl text-4xl font-extrabold leading-[1.05] tracking-[-.05em] md:text-5xl">Good work starts with a clear brief.</h1><p className="mt-4 max-w-xl text-sm leading-7 text-muted-foreground md:text-base">Create a profile and see service requests matched to the work you do. Submit a quote with your real scope and price, right from here.</p><div className="mt-6 flex items-center gap-3 rounded-xl border border-border bg-card p-4 text-sm"><ShieldCheck size={18} className="shrink-0 text-primary"/><span>Customers compare what you send and choose whether to accept.</span></div>{!isLoaded ? <div className="mt-8"><LoadingRows count={2}/></div> : isSignedIn ? <div className="mt-8"><ProviderOnboarding/></div> : <div className="mt-8 rounded-2xl border border-border bg-card p-6"><h2 className="font-bold">Sign in to get started</h2><p className="mt-1 text-sm leading-6 text-muted-foreground">Provider profiles and request responses belong to your account.</p><Link href="/sign-in" className="mt-4 inline-flex rounded-lg bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground" data-testid="link-provider-sign-in">Sign in</Link></div>}</div>
    <section><div className="mb-5 flex flex-wrap items-end justify-between gap-4"><div><div className="text-[11px] font-bold uppercase tracking-[.15em] text-primary">Matched to your services</div><h2 className="serif mt-2 text-3xl font-bold">Open requests</h2></div><Badge>{requests.data?.length ?? 0} requests</Badge></div>
      {!isSignedIn ? <StatePanel title="Requests are account-specific" body="Sign in and create a provider profile to see service requests matched to your services and area."/> : requests.isLoading ? <LoadingRows/> : requests.isError ? <ErrorNote message="Matched requests could not be loaded." onRetry={() => void requests.refetch()}/> : requests.data?.length ? <div className="space-y-4">{requests.data.map(job => <article key={job.id} className="rounded-2xl border border-border bg-card p-5 md:p-6" data-testid={`card-provider-request-${job.id}`}><div className="flex flex-wrap items-start justify-between gap-3"><div><Badge tone={job.status === 'OPEN' ? 'green' : 'neutral'}>{nice(job.status)}</Badge><h3 className="mt-3 text-lg font-bold">{job.serviceName}</h3></div><span className="text-xs text-muted-foreground">{date(job.createdAt)}</span></div><p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">{job.description}</p><div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground"><span className="flex items-center gap-1.5"><MapPin size={14}/>{job.city}, {job.countryCode}</span><span>{nice(job.urgency)}</span><span>{nice(job.propertyType)}</span></div>{quoted.includes(job.id) ? <div role="status" className="mt-4 rounded-lg bg-accent px-4 py-3 text-sm font-semibold text-primary" data-testid={`status-quote-sent-${job.id}`}>Quote submitted. It’s now part of your marketplace record.</div> : <QuoteSubmission jobId={job.id} onDone={() => setQuoted(old => [...old, job.id])}/>}</article>)}</div> : <StatePanel title="No matching requests at the moment" body="When a customer request matches your services and location, it will appear here. Check back later."/>}
    </section>
    {isSignedIn && requests.data?.length ? <section className="mt-8"><div className="mb-4"><div className="text-[11px] font-bold uppercase tracking-[.15em] text-primary">Messages</div><h2 className="serif mt-1 text-2xl font-bold">Request conversations</h2></div><div className="space-y-3">{requests.data.map(job => <JobMessagesPanel key={job.id} jobId={job.id} jobLabel={job.serviceName} collapsible/>)}</div></section> : null}
  </div></PageWrap></Shell>;
}
