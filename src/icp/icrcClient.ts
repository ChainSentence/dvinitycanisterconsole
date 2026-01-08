// src/icp/icrcClient.ts
import { Actor, HttpAgent } from "@dfinity/agent";
import { IDL } from "@dfinity/candid";
import { Principal } from "@dfinity/principal";
import { getAgent } from "./auth";

const idlFactory: IDL.InterfaceFactory = ({ IDL }) => {
  const Account = IDL.Record({
    owner: IDL.Principal,
    subaccount: IDL.Opt(IDL.Vec(IDL.Nat8)),
  });

  const TransferArgs = IDL.Record({
    to: Account,
    amount: IDL.Nat,
    fee: IDL.Opt(IDL.Nat),
    memo: IDL.Opt(IDL.Vec(IDL.Nat8)),
    from_subaccount: IDL.Opt(IDL.Vec(IDL.Nat8)),
    created_at_time: IDL.Opt(IDL.Nat64),
  });

  const TransferError = IDL.Variant({
    BadFee: IDL.Record({ expected_fee: IDL.Nat }),
    BadBurn: IDL.Record({ min_burn_amount: IDL.Nat }),
    InsufficientFunds: IDL.Record({ balance: IDL.Nat }),
    TooOld: IDL.Null,
    CreatedInFuture: IDL.Record({ ledger_time: IDL.Nat64 }),
    TemporarilyUnavailable: IDL.Null,
    Duplicate: IDL.Record({ duplicate_of: IDL.Nat }),
    GenericError: IDL.Record({
      message: IDL.Text,
      error_code: IDL.Nat,
    }),
  });

  const TransferResult = IDL.Variant({
    Ok: IDL.Nat,
    Err: TransferError,
  });

  return IDL.Service({
    icrc1_balance_of: IDL.Func([Account], [IDL.Nat], ["query"]),
    icrc1_transfer: IDL.Func([TransferArgs], [TransferResult], []),
  });
};

async function getIcrcActor(canisterId: string) {
  const agent: HttpAgent = await getAgent();
  // geen candid fetch, pure static IDL
  return Actor.createActor<any>(idlFactory, { agent, canisterId });
}

export async function icrc1BalanceOf(
  canisterId: string,
  ownerPrincipal: string,
  subaccount?: Uint8Array | null
): Promise<bigint> {
  const actor = await getIcrcActor(canisterId);
  const account = {
    owner: Principal.fromText(ownerPrincipal),
    subaccount: subaccount ? [Array.from(subaccount)] : [],
  };
  const balance = await actor.icrc1_balance_of(account);
  return balance as bigint;
}

export async function icrc1Transfer(
  canisterId: string,
  toPrincipal: string,
  amount: bigint,
  fromSub?: Uint8Array | null,
  toSub?: Uint8Array | null
): Promise<{ Ok?: bigint; Err?: any }> {
  const actor = await getIcrcActor(canisterId);

  const to = {
    owner: Principal.fromText(toPrincipal),
    subaccount: toSub ? [Array.from(toSub)] : [],
  };

  const args = {
    to,
    amount,
    fee: [], // null
    memo: [], // null
    from_subaccount: fromSub ? [Array.from(fromSub)] : [],
    created_at_time: [], // null
  };

  const res = await actor.icrc1_transfer(args);
  return res as { Ok?: bigint; Err?: any };
}
