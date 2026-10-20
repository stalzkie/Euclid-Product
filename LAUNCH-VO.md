# Euclid — launch video voice-over

~2:00 at a normal reading pace. `[ ]` lines are visual cues, not spoken.
Slashes mark breath beats. Every claim below was checked against the code and
against the live Polar account on 2026-10-21 — see "What has to stay true" at
the end before changing any number.

---

**[0:00 — cold open: a founder's app, a floating "Feedback" tab in the corner]**

You shipped the thing. / Now everyone wants something different.

**[0:07 — the widget opens in place, posts and upvote counts]**

Euclid is a feedback board that lives inside your product. One script tag.
Your users suggest features, upvote each other, and you finally see the list
instead of guessing at it.

**[0:18 — the designer screen, accent colour snapping to match the host site]**

It looks like your app, not like somebody else's tool. Point Euclid at your
site and it reads your colours, your corners, your theme, and proposes a board
that matches. Nothing changes until you say so.

**[0:30 — the inbox: a duplicate nudge appearing under a new post]**

Then the noise handling. The same request arrives nine times in nine different
wordings — Euclid spots the duplicates as they're typed and offers the merge.
It groups everything into themes and names them. It shows you what's actually
gaining momentum, not just what shouted loudest.

**[0:45 — Insights: top requests, velocity, status funnel]**

And votes carry weight. A paying customer's vote counts for more in your view
of the list / while your users only ever see a simple headcount. No one feels
ranked by their card.

**[0:56 — a post selected → Build Prompt generating]**

Here's the part no other feedback tool does. Pick a request, hit Build Prompt,
and Euclid writes the brief — / the problem, the acceptance criteria, the
edge cases, pointed at your actual repo if you connect one. Ready to paste
into Claude Code, Codex, Cursor, whatever you build with.

**[1:10 — the prompt copied, then a changelog entry going out]**

So the loop closes. A user asks. You ship. They get the email that says their
request went live, / and they come back and ask for the next thing.

**[1:20 — Ask Euclid chat answering with citations]**

Pro adds Ask Euclid — ask your own feedback a question in plain English and
get an answer with the posts it came from. Plus a weekly digest of what to
build next, unlimited boards, and your own domain.

**[1:30 — pricing card: Indie $12, Pro $29, 7-day trial]**

Twelve dollars a month for Indie, twenty-nine for Pro, seven days free to try
either one. Yearly works out cheaper — / and if you're a student it's half
price, the whole time you're studying. Verify a school address; there's no
code to type.

**[1:38 — promo card]**

And for launch: take Indie monthly through the link below and it's nine
dollars a month for your first four — / four months for the price of three.
You also get a month of Bernn Pro free — my iOS app. It watches what you're
burning on AWS, Anthropic and OpenAI, and tells you before the bill does.
First fifty founders.

**[1:50 — referral link being copied from Billing]**

One more. Every Euclid account has a referral link. Anyone who signs up
through yours and pays earns you four Build Prompts for every dollar they
spend — / and it keeps paying every month they renew, not just the first one.

**[2:00 — logo, URL]**

Euclid. Your users already told you what to build. / Now you can build it.

**[end card: euclidhq.com]**

---

## What has to stay true

Checked against the code and the live Polar organisation on 2026-10-21. Each
line here is a claim the video makes that something in the product has to keep
backing up.

**"Four months for the price of three" — not five months.** The shipped
mechanic is 25% off for four months on Indie Monthly: $9 x 4 = $36 = three
months at list. Polar cannot express "three paid, one free" — a subscription
interval is day/week/month/year and a repeating discount applies the same
percentage every period. A live quote reads `$12.00` subtotal, `-$3.00`,
`$9.00`. The subscription then renews normally at $12.

**"Indie monthly" is load-bearing.** `promoEligible` refuses Pro and refuses
yearly, and the checkout re-derives it server-side, so a Pro-flavoured promise
breaks at the checkout page. Pro carrying the promo link quotes $29 - 20% =
$23.20 on the ordinary launch discount instead.

**"First fifty" is the real cap.** `max_redemptions: 50`,
`max_redemptions_per_customer: 1`. It is matched deliberately to the 50 Bernn
codes already minted, so the two halves of the promise cannot disagree.

**"The link below" has to exist.** The promotion is only applied to a founder
who arrived through `?promo=indie3`. As of 2026-10-21 the app captures that
into a cookie that survives the sign-up redirect, so the link to publish is
`app.euclidhq.com/signup?promo=indie3`. **euclidhq.com does not carry it yet** —
without a button there, every viewer of this video pays list price and gets no
Bernn code, and it is not recoverable after the fact.

**The Bernn code arrives on the first real payment, not at signup.** The
webhook grants it on the first order with money in it, which deliberately
skips the trial's $0 invoice. Anyone starting a trial gets Bernn a week later.
Worth saying in the landing copy even though it does not belong in the VO.

**Student is 50%, forever, and does not stack.** One discount applies per
checkout and the student rate wins — a verified student arriving through the
promo link pays 50% rather than 25% and still gets the Bernn code.

**No yearly totals on screen.** `plans.ts` says $10/mo and $24/mo for Indie
and Pro yearly ($120 and $288 a year); Polar actually charges $100 and $240.
Nobody is overcharged, but the "2 months free" toggle is nearer three and a
half, and it is an open pricing decision — see `HANDOFF.md` §"What is left"
item 8. Say "cheaper yearly" with no number until that is settled.

**Optional, and it dates the video:** there is also a codeless Launch 20% off
the first invoice, applied to every checkout, which is the only launch
discount a Pro or yearly buyer can get. It ends 2026-11-11. Mentioning it
gives this video about three weeks of shelf life, which is why it is not in
the script above.

**One number someone will check:** the referral reward is four Build Prompts
per dollar of `net_amount` — after discount, before tax. A promo'd $9 month
earns 36, not 48, and a trial's $0 invoice earns nothing.
