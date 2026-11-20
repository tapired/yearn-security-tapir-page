# Flex Allocator adversarial adjudication

Reviewed `flexmeow/flex-allocator@c2eb7759f4d3a60cd4ab8966c98f92254820230c` against base `96389e2a78dee8733fda2d3f2dd1d502a61904a0`, using the supplied pinned dependencies. Both candidate sets were evaluated independently and deduplicated into four issues. All four survive source-level review under the preconditions below; router and emergency execution remain conditional.

Detailed dispositions remain in the private review workspace. This is not an exhaustive audit or deployed security assurance.

The target explicitly inherits `BaseHealthCheck` at [src/Strategy.sol:16](https://github.com/flexmeow/flex-allocator/blob/c2eb7759f4d3a60cd4ab8966c98f92254820230c/src/Strategy.sol#L16), establishing its Tokenized Strategy composition.

| Area | Verified implementation |
|---|---|
| Assets and claims | Borrow-token cash, Lender shares, retained auction receivables, and specialized collateral/cooldown claims back wrapper shares. Borrower debt belongs to the external Flex market. |
| Accounting | Tokenized Strategy records assets manually. Reports reconcile backing but currently count only cash and remaining Lender shares. Profits can produce fee shares and locked shares. |
| Time transitions | Lender reports, wrapper reports, interest accrual, profit unlocking, auction decay/re-kick and external cooldowns proceed independently. Auction expiry does not settle a receivable. No target reward or epoch ledger was identified. |
| Permissions and hooks | Management controls forced unwinds, deposits and health checks. Keeper or management reports. Emergency-authorized callers can shut down and unwind. Router and Lender hooks assign withdrawal receivers. |
| Integrations | Lido, InfiniFi, Locked yvUSD and fxSAVE track different unwind states. Their pending-value checks gate reporting rather than include pending value in NAV. |
| Emergency and upgrades | Shutdown stops deposits while permitting exits and reports. Integration addresses are immutable; BaseStrategy delegates to a constant implementation address. No target upgrade entry point was found. |

Derived invariants: retained claims must preserve shareholder ownership; genuine losses must be allocated before exits consume backing; collateral minima must constrain their corresponding withdrawals; burned Lender claims must leave adequate delivery or attributable receivables.

## [High] Unreported Lender losses are shifted onto remaining wrapper holders

### Details

**Accepted, remaining. Independent candidate 2 / specialist candidate 2.** The root is [src/Strategy.sol:105](https://github.com/flexmeow/flex-allocator/blob/c2eb7759f4d3a60cd4ab8966c98f92254820230c/src/Strategy.sol#L105) and [src/Strategy.sol:212](https://github.com/flexmeow/flex-allocator/blob/c2eb7759f4d3a60cd4ab8966c98f92254820230c/src/Strategy.sol#L212). The withdrawal limit caps aggregate backing, while `_freeFunds` spends Lender shares at their reduced current price to satisfy an asset request priced from stale wrapper accounting.

Flex can recognize an uncovered liquidation loss on the Lender at [trove_manager.vy:1237](https://github.com/johnnyonline/flex-contracts/blob/6c3a6e106668946efec061587d2ac85efc05d1eb/src/trove_manager.vy#L1237). Nothing synchronously reconciles the wrapper.

**Preconditions:** Lender PPS falls after available buffers; the wrapper remains unreconciled; multiple economic holders exist; sufficient liquidity permits an early exit. With 100 wrapper shares, recorded assets of 100 and actual backing of 80, a half-holder can receive 50. The remaining holder receives backing worth 30 rather than 40. Complete cash delivery avoids any withdrawal-shortfall check.

**Counterevidence:** adequate buffers, insufficient liquidity or a completed wrapper report prevents this example. [Strategy.t.sol:571](https://github.com/flexmeow/flex-allocator/blob/c2eb7759f4d3a60cd4ab8966c98f92254820230c/test/Strategy.t.sol#L571) checks the aggregate cap after a synthetic markdown, not proportional loss allocation. Actual liquidation reporting requires a working Lender keeper. Multi-holder deployment reachability remains unverified.

### Recommendation

Reconcile genuine backing deficits before withdrawal pricing, or block exits until reconciliation. Include retained auction and cooldown claims when distinguishing impairment from temporary illiquidity. Add a two-holder loss-allocation test.

## [Medium] Removing the report guard permits reports that omit retained auction claims

### Details

**Accepted, new regression for `forceFreeFunds`; emergency omission already existed. Independent candidate 1 / specialist candidate 1.** [src/Strategy.sol:129](https://github.com/flexmeow/flex-allocator/blob/c2eb7759f4d3a60cd4ab8966c98f92254820230c/src/Strategy.sol#L129) can replace Lender shares with an auction payable to the strategy. [src/Strategy.sol:222](https://github.com/flexmeow/flex-allocator/blob/c2eb7759f4d3a60cd4ab8966c98f92254820230c/src/Strategy.sol#L222) omits that receivable after removal of the independent settlement guard.

**Preconditions:** an authorized unwind leaves material proceeds unsettled and an authorized report passes. The [health check:150](https://github.com/yearn/tokenized-strategy-periphery/blob/fc1b1d4ab5c9a0b65b7ac785734c404d3742317a/src/Bases/HealthCheck/BaseHealthCheck.sol#L150) admits this when a loss allowance covers the omission, management bypasses one report, or recognized gains offset it. For example, 1,000 recorded assets plus 50 of Lender gains minus 20 awaiting auction settlement reports 1,030 and passes zero loss tolerance.

The incomplete value becomes recorded assets. Intervening exits or eligible deposits can redistribute eventual recovery. Following a temporary 100-to-90 markdown without a locked-profit buffer, a permitted deposit of 9 receives 10 shares; after full recovery and unlocking, those shares represent approximately 9.91. Recovery is also processed as profit, potentially triggering fees where enabled.

**Counterevidence:** zero loss tolerance rejects an uncompensated decrease. The independent [cooldown guard:131](https://github.com/flexmeow/flex-allocator/blob/c2eb7759f4d3a60cd4ab8966c98f92254820230c/src/integrations/CooldownStrategy.sol#L131) survives; health-check bypass alone cannot defeat it. Plain forced withdrawals can nevertheless leave untracked auctions in cooldown integrations. Scripts and inspected broadcasts set wrapper performance fees and profit-unlock time to zero; deployed fee impact is unestablished.

### Recommendation

Track every retained auction, including emergency-created claims, or block reports until material claims settle. Separate bounded aggregate dust reconciliation from loss tolerance and health-check bypass. Test offsetting gains and multiple genuinely outstanding auctions.

## [Medium] Emergency exits accept share burns without sufficient redemption coverage

### Details

**Accepted as a conditional source-level integration defect, remaining. Independent candidate 3 / specialist candidate 4.** [src/Strategy.sol:228](https://github.com/flexmeow/flex-allocator/blob/c2eb7759f4d3a60cd4ab8966c98f92254820230c/src/Strategy.sol#L228) redeems Lender shares without validating cash delivery or auction coverage.

The Lender accepts the default 100% immediate withdrawal loss. Its redemption walk stops after 1,000 troves, and the auction covers only debt actually processed: [Lender.sol:120](https://github.com/johnnyonline/flex-contracts/blob/6c3a6e106668946efec061587d2ac85efc05d1eb/src/lender/Lender.sol#L120), [trove_manager.vy:1342](https://github.com/johnnyonline/flex-contracts/blob/6c3a6e106668946efec061587d2ac85efc05d1eb/src/trove_manager.vy#L1342), and [trove_manager.vy:1445](https://github.com/johnnyonline/flex-contracts/blob/6c3a6e106668946efec061587d2ac85efc05d1eb/src/trove_manager.vy#L1445). Tokenized Strategy nevertheless burns the requested shares at [TokenizedStrategy.sol:1038](https://github.com/yearn/tokenized-strategy/blob/82806289f967590c4efbf6bc3d237e4e7f0a0966/src/TokenizedStrategy.sol#L1038).

**Preconditions:** shutdown, emergency authorization, insufficient idle liquidity, a request exceeding the bounded walk’s coverage, and successful transaction execution. Burning a claim worth 200 while processing only 100 leaves an auction capped at 100. Unprocessed debt remains in the Lender after the wrapper relinquishes its corresponding shares.

**Counterevidence:** smaller chunks and complete redemptions avoid the shortfall. Management can use ordinary forced withdrawals with protective minima. This is a privileged operational hazard. Existing partial-redemption tests were not executed here, and cold-state gas feasibility remains unverified. An out-of-gas transaction reverts without this loss.

### Recommendation

Validate immediate delivery plus attributable auction coverage, or provide explicit minimum coverage for emergency unwinds. Test the shutdown path with partial redemption under realistic gas limits.

## [Medium] Shared Dutch Desks misattribute per-strategy collateral minima

### Details

**Accepted as a configuration-dependent source defect, remaining. Independent candidate 4 / specialist candidate 3.** [ExitRouter.sol:54](https://github.com/flexmeow/flex-allocator/blob/c2eb7759f4d3a60cd4ab8966c98f92254820230c/src/periphery/ExitRouter.sol#L54) snapshots every nonce before redemption; [ExitRouter.sol:64](https://github.com/flexmeow/flex-allocator/blob/c2eb7759f4d3a60cd4ab8966c98f92254820230c/src/periphery/ExitRouter.sol#L64) checks each minimum against that snapshot afterward.

**Preconditions:** two distinct permitted wrappers share a Dutch Desk, and one vault redemption visits both and creates separate auctions. Both cache `N`, although their withdrawals create `N` and `N+1`. Both minimum checks inspect `N`. Consequently, collateral lots of 100 and 50 can pass respective minima of 100 and 100.

**Counterevidence:** distinct Desks avoid the collision. Records show shared Lenders across different destinations, not the necessary shared-vault withdrawal configuration. The exact outer vault implementation and enclosing execution are absent. No deployed loss is asserted. A common proceeds receiver does not make checking the same collateral lot twice sufficient.

### Recommendation

Reject duplicate Dutch Desks within one routed redemption, or bind each minimum to its corresponding withdrawal’s auction. Test both visit orders using the supported vault implementation.

## [Informational] Dust no longer hard-locks forced withdrawals, but reporting remains conditional

### Details

**The timestamp-guard deadlock is fixed; unconditional reporting safety is unestablished.** The auction rounds sufficiently small payments to zero and rejects them at [auction.vy:388](https://github.com/johnnyonline/flex-contracts/blob/6c3a6e106668946efec061587d2ac85efc05d1eb/src/auction.vy#L388), leaving an unsettled timestamp. Removing the withdrawal guard removes that residue’s independent ability to block further unwinds.

A rounding deficit can still fail the default zero-loss health check. [DustAuction.t.sol:63](https://github.com/flexmeow/flex-allocator/blob/c2eb7759f4d3a60cd4ab8966c98f92254820230c/test/DustAuction.t.sol#L63) explicitly enables a one-basis-point allowance.

The wrong-old-auction hypothesis for `forceFreeFundsInKind` is rejected: [CooldownStrategy.sol:101](https://github.com/flexmeow/flex-allocator/blob/c2eb7759f4d3a60cd4ab8966c98f92254820230c/src/integrations/CooldownStrategy.sol#L101) captures the next nonce before its own withdrawal. However, the added tests exhaust the original Lender position before the second call, leaving material concurrent-auction accounting untested. Direct collateral donations do not increment tracked pending counters.

### Recommendation

Use narrowly bounded dust reconciliation while protecting material receivables. Test zero-loss rounding, two actual outstanding auctions, and a new in-kind auction while an older auction remains open.

## [Informational] Runtime equivalence and integration assumptions remain unverified

### Details

Fourteen focused offline arithmetic assertions passed, including adverse cases and controls. They establish accounting consequences, not EVM reachability. Compilation and fork tests were unavailable because required libraries/build artifacts are absent and [test/Base.sol:55](https://github.com/flexmeow/flex-allocator/blob/c2eb7759f4d3a60cd4ab8966c98f92254820230c/test/Base.sol#L55) requires RPC access.

Scripts, README and broadcasts provide addresses and recorded receipts, but not bytecode equivalence to this head or current permissions, health settings, claims, allocations and queues. The external keeper and outer vault implementations are missing. The Locked yvUSD deployment script retains a zero Lender placeholder.

The allocator gitlink selects periphery `fc1b1d4…`, while its lockfile names `d732e918…`; Flex pins the latter. Relevant historical hooks were cross-checked locally. Callback theft, InfiniFi rate-change accounting and Lido donated-request consumption remain unvalidated hypotheses.

All four reviewed worktrees remain clean. No source was edited, staged, committed or published.

### Recommendation

Supply bytecode/configuration snapshots and exact external implementations. Restore reproducible offline build inputs and run the focused regressions above. The remote report requires the prescribed fetch before becoming authoritative on the Mac.
