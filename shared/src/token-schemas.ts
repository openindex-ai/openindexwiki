/**
 * Request schemas for the $OpenIndex wallet and top-up endpoints. Kept apart from ./schemas so
 * bundles that never use them (the CLI) leave them, and the token code they pull in, out
 * (the package is marked side-effect free).
 */
import { z } from "zod";
import { isSolanaAddress } from "./token";
import { MAX_TOKEN_TOPUP_CENTS, MIN_TOKEN_TOPUP_CENTS } from "./token-topup";
import { HANDLE_TERMS } from "./handles";

const solanaAddressSchema = z.string().trim().refine(isSolanaAddress, { message: "Not a Solana address (base58 of a 32-byte public key)" });

/** Ask for a message to sign with this wallet. */
export const walletChallengeSchema = z.object({ address: solanaAddressSchema });
export type WalletChallengeInput = z.infer<typeof walletChallengeSchema>;

/** Link the wallet: the challenge's nonce and the base58 ed25519 signature of its message. */
export const linkWalletSchema = z.object({
  nonce: z.string().regex(/^[a-f0-9]{32}$/, "nonce must come from POST /api/wallet/challenge"),
  signature: z.string().trim().min(64).max(100),
});
export type LinkWalletInput = z.infer<typeof linkWalletSchema>;

/** Quote a top-up paid in $OpenIndex: the dollar value to pay, in cents. */
export const tokenTopupQuoteSchema = z.object({
  cents: z.number().int().min(MIN_TOKEN_TOPUP_CENTS).max(MAX_TOKEN_TOPUP_CENTS),
});
export type TokenTopupQuoteRequest = z.infer<typeof tokenTopupQuoteSchema>;

/**
 * Submit a quote's transaction: either signed by the wallet and not yet sent (`transaction`,
 * base64 wire format; the server sends it), or already sent by the wallet (`signature`, base58).
 */
export const tokenTopupSubmitSchema = z
  .object({
    transaction: z.string().trim().min(100).max(4000).optional(),
    signature: z.string().trim().min(64).max(100).optional(),
  })
  .refine((v) => Boolean(v.transaction) !== Boolean(v.signature), { message: "send exactly one of transaction or signature" });
export type TokenTopupSubmitRequest = z.infer<typeof tokenTopupSubmitSchema>;

/** Quote a handle purchase paid by burning $OpenIndex. */
export const handleQuoteSchema = z.object({
  handle: z.string().trim().min(1).max(40),
  term: z.enum(HANDLE_TERMS),
});
export type HandleQuoteRequest = z.infer<typeof handleQuoteSchema>;

/** Choose which of your handles shows on your profile and bylines. */
export const setPrimaryHandleSchema = z.object({ handle: z.string().trim().min(1).max(40) });
