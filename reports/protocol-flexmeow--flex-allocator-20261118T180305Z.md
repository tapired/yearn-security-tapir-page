# Flex Allocator adversarial adjudication

Target: `96389e2a78dee8733fda2d3f2dd1d502a61904a0`. Flex snapshot: `ac0835f47e8cf7a3b3e7db2dbe3ac5cbebd5148d`.

Five unique candidates were evaluated independently. Four source-level findings are accepted with the conditions below; the callback theft claim remains unvalidated. Detailed dispositions remain in the private review workspace.

Assets flow through allocator shares, strategy shares and Lender shares into idle borrow tokens and borrower debt. Withdrawals can replace those assets with auction receivables, collateral or external cooldown claims. Lender reports, allocator reports, auction expiry and cooldown windows advance independently. Management controls forced withdrawals and cooldown operations; the router temporarily controls withdrawal receivers. The governing invariants are proportional loss allocation, complete claim tracking, correct auction attribution and recoverable settlement gates.

## [High] Stale allocator pricing transfers realized losses to remaining holders

### Details

Accepted from both candidate sets. Flex can report an uncovered liquidation loss immediately, reducing Lender share value ([trove_manager.vy:1237](https://github.com/flexmeow/flex-contracts/blob/ac0835f47e8cf7a3b3e7db2dbe3ac5cbebd5148d/src/trove_manager.vy#L1237)). The allocator updates separately, while its withdrawal hook purchases the stale asset request using additional Lender shares ([Strategy.sol:237](https://github.com/flexmeow/flex-allocator/blob/96389e2a78dee8733fda2d3f2dd1d502a61904a0/src/Strategy.sol#L237)).

Preconditions are an actual Lender markdown after buffers, no allocator reconciliation, multiple economic holders and sufficient idle liquidity. With 200 recorded assets and 180 backing, an equal holder can receive approximately 100, leaving 80 instead of allocating 90 each.

The aggregate withdrawal cap limits total recoverable assets but does not allocate loss proportionally. Existing tests explicitly retain stale allocator pricing and permit withdrawing backing for fewer than all allocator shares.

### Recommendation

Reconcile backing deficits before pricing exits, or block withdrawals until proportional loss accounting completes. Verify using multiple holders withdrawing before and after reconciliation.

## [Medium] Unpayable auction dust can indefinitely block reporting and forced withdrawals

### Details

Accepted from the independent set, with narrowed impact. Reports and management forced withdrawals require the tracked auction’s timestamp to clear ([Strategy.sol:146](https://github.com/flexmeow/flex-allocator/blob/96389e2a78dee8733fda2d3f2dd1d502a61904a0/src/Strategy.sol#L146), [Strategy.sol:243](https://github.com/flexmeow/flex-allocator/blob/96389e2a78dee8733fda2d3f2dd1d502a61904a0/src/Strategy.sol#L243)). Flex clears it only after complete collateral consumption, but rejects takes whose payment rounds to zero ([auction.vy:382](https://github.com/flexmeow/flex-contracts/blob/ac0835f47e8cf7a3b3e7db2dbe3ac5cbebd5148d/src/auction.vy#L382)).

A partial fill can leave representable collateral residue worth less than one borrow-token base unit. Expiry does not clear the timestamp; re-kicking can preserve the zero-payment condition. No allocator reconciliation escape exists.

This blocks reporting and further forced withdrawals. It does not establish that all exit paths become unavailable, or that no future collateral price could restore payability.

### Recommendation

Support bounded, auditable reconciliation of immaterial residue, or require a settlement interface that permits complete dust consumption.

## [Medium] Emergency withdrawals omit retained auctions from reporting guards

### Details

Accepted from both sets, conditional on reporting configuration. The [emergency withdrawal hook](https://github.com/flexmeow/flex-allocator/blob/96389e2a78dee8733fda2d3f2dd1d502a61904a0/src/Strategy.sol#L250) can initiate an auction payable to the strategy without recording its ID. Reporting checks only the previously tracked auction and values idle tokens plus remaining Lender shares.

Preconditions include an authorized emergency withdrawal beyond idle liquidity, unsettled proceeds and report settings accepting the apparent decrease. Consequently, 80 remaining Lender assets plus a 20 receivable can be reported as 80. Intervening exits and later recovery can allocate value to different holders.

A restrictive health check can reject this report. Existing emergency tests cover liquid withdrawals; fee extraction is not established, and deployment scripts request zero strategy performance fees.

### Recommendation

Track every emergency-created retained auction and prevent incomplete valuation until settlement or explicit reconciliation.

## [Medium] Shared Dutch Desks cause collateral minima to inspect the wrong auction

### Details

Accepted from both sets, conditional on vault configuration. The router snapshots every Desk nonce before withdrawal, then checks each minimum against that saved ID ([ExitRouter.sol:54](https://github.com/flexmeow/flex-allocator/blob/96389e2a78dee8733fda2d3f2dd1d502a61904a0/src/periphery/ExitRouter.sol#L54), [ExitRouter.sol:69](https://github.com/flexmeow/flex-allocator/blob/96389e2a78dee8733fda2d3f2dd1d502a61904a0/src/periphery/ExitRouter.sol#L69)).

If one exit visits two wrappers sharing a Desk, both cache `N`, while their withdrawals create `N` and `N+1`. Both checks inspect `N`; a large first lot can therefore conceal an insufficient second lot.

The factory permits distinct same-market wrappers, but supplied records do not establish their registration in one deployed vault. One wrapper per Desk avoids this condition.

### Recommendation

Reject duplicate Desks before arming receivers, or bind each minimum to the auction produced by its corresponding withdrawal.

## [Informational] Callback theft candidate lacks an established authority path

### Details

The caller-selected strategy list permits callbacks while another strategy’s receiver is armed ([ExitRouter.sol:82](https://github.com/flexmeow/flex-allocator/blob/96389e2a78dee8733fda2d3f2dd1d502a61904a0/src/periphery/ExitRouter.sol#L82)). That surface is verified.

The proposed theft additionally requires suitable vault debt-management authority, loss-tolerant withdrawal of vault-owned shares and successful completion of the enclosing redemption. The exact vault implementation and a limited-authority configuration demonstrating this boundary are absent. Broad curator powers alone do not establish an incremental theft capability.

The candidate is therefore unvalidated. Receiver clearing prevents the tested sequential attempt but does not disprove callbacks during the setter loop.

### Recommendation

Verify the exact vault and role boundary. Authenticate the complete strategy list before arming receivers and eliminate caller-selected callbacks during that interval.

## [Informational] Execution and deployment evidence remain incomplete

### Details

Required inherited libraries are absent, and supplied tests require an RPC fork. No compilation or EVM tests were run. Offline arithmetic checks support the loss-allocation, dust, nonce-aliasing and omitted-receivable conclusions.

Local history confirms identical Flex runtime source between the allocator’s Flex gitlink and the supplied snapshot. Exact inherited execution, external queues, deployed bytecode, current roles, withdrawal queues and safeguards remain unverified.

Reviewed source was unchanged; nothing was staged, committed or pushed. These dispositions do not constitute an exhaustive audit or deployed security assurance.

### Recommendation

Supply exact inherited dependencies and vault implementations, run focused regressions, and obtain block-specific bytecode and configuration evidence before asserting live exposure.