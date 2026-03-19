# Next project steps
- introduce unit tests to the typescript code
- solution redesign IG-2
- create tech spec for event sources
- implement event sources
- setup AWS SES

## IG-2 Only matched events persisted to sent-keys; unmatched events re-evaluated forever

`saveSentKeys` receives only matchResult.matched.map(m => m.event). Events the LLM rejects are never recorded in events-sent.json and will be submitted to the LLM on every future run indefinitely. This is technically what the spec says ("persist newly matched events"), but it may be unintentional: an event that doesn't match today won't match next week unless preferences change. Unbounded LLM token spend grows as more events accumulate. Worth deciding: persist all evaluated events, or only matched?