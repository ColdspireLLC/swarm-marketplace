// Whether a thread's turn ending ends its hold on a machine (Turns),
// apart from turns.ts so it's tested without Swarm.

/**
 * Says whether the end of a thread's turn ended ends a hold it took for
 * turn holdFor: its own turn's end or a later one's does; an earlier
 * one's, heard late (nothing waits for the turnEnd hook), doesn't. Either
 * not known: it does, as a turn's end always did.
 */
export function endsHold(holdFor: number | undefined, ended: number | undefined): boolean {
	return holdFor === undefined || ended === undefined || ended >= holdFor;
}
