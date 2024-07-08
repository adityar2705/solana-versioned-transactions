import { initializeKeypair } from "./initializeKeypair"
import * as web3 from "@solana/web3.js"

async function main() {
  // Connect to the devnet cluster
  const connection = new web3.Connection(web3.clusterApiUrl("devnet"))

  // Initialize the user's keypair
  const user = await initializeKeypair(connection)
  console.log("PublicKey:", user.publicKey.toBase58())

  // Generate 22 addresses
  const recipients = []
  for (let i = 0; i < 22; i++) {
    recipients.push(web3.Keypair.generate().publicKey)
  }

  //create the lookup table and wait for it to be usable
  const lookupTableAddress = await initializeLookupTable(user,connection, recipients);
  await waitForNewBlock(connection,1);

  //get the specific lookup table account
  const lookupTableAccount = (await connection.getAddressLookupTable(lookupTableAddress)).value;

  if (!lookupTableAccount) {
    throw new Error("Lookup table not found");
  }

  //transfer instructions
  const transferInstructions = recipients.map((recipient) => {
    return web3.SystemProgram.transfer({
      fromPubkey: user.publicKey,
      toPubkey: recipient,
      lamports: web3.LAMPORTS_PER_SOL * 0.01,
    });
  });

  await sendV0Transaction(connection, user, transferInstructions, [
    lookupTableAccount,
]);

}

//helper function to create a V0 transaction using @solana/web3.js -> ? means it could be undefined also
async function sendV0Transaction(
  connection : web3.Connection,
  user : web3.Keypair,
  instructions: web3.TransactionInstruction[],
  lookupTableAccounts ?: web3.AddressLookupTableAccount[]
){
  //get latest blockhash and last valid block height
  const { lastValidBlockHeight, blockhash } = await connection.getLatestBlockhash();

  //create a new V0 transaction message
  const messageV0 = new web3.TransactionMessage({
    payerKey: user.publicKey,
    recentBlockhash:blockhash,
    instructions, //to include inn the transaction
  }).compileToV0Message(
    lookupTableAccounts ? lookupTableAccounts : undefined,
  );

  //create a new transaction message
  const transaction = new web3.VersionedTransaction(messageV0);

  //sign the transaction
  transaction.sign([user]);

  //send the transaction to the cluster
  const txid = await connection.sendTransaction(transaction);

  //confirm the transaction
  await connection.confirmTransaction({
    blockhash:blockhash,
    lastValidBlockHeight:lastValidBlockHeight,
    signature:txid
  },"finalized");

  // Log the transaction URL on the Solana Explorer
  console.log(`https://explorer.solana.com/tx/${txid}?cluster=devnet`);
}

//we need to wait for atleast one block before we can access the created/extended address lookup table
async function waitForNewBlock(
  connection: web3.Connection,
  targetHeight : number
){
  console.log(`Waiting for ${targetHeight} new blocks`);
  
  //returning a new promise
  return new Promise(async (resolve : any) => {
    //get last valid block height
    const { lastValidBlockHeight } = await connection.getLatestBlockhash();

    //set an interval to check for new blocks every 1000ms
    const intervalId = setInterval(async () => {
      //IMP : this is how you assign a name while accessing that specific variable in TS
      const { lastValidBlockHeight : newValidBlockHeight } = await connection.getLatestBlockhash();

      //check if new valid block height is greater than target block height
      if(newValidBlockHeight > lastValidBlockHeight + targetHeight){
        clearInterval(intervalId);
        resolve();
      }
    },1000);
  })
}

//function to initialize a lookup table and return its address
async function initializeLookupTable(
  user : web3.Keypair,
  connection: web3.Connection,
  addresses : web3.PublicKey[]
): Promise<web3.PublicKey>{
  //get the current slot
  const slot = await connection.getSlot();

  //create the table and get the address
  const [ lookupTableInst, lookupTableAddress ] = web3.AddressLookupTableProgram.createLookupTable({
    authority: user.publicKey,
    payer: user.publicKey,
    recentSlot: slot - 1
  })
  console.log("Lookup table address : ", lookupTableAddress.toBase58() );

  //create an instruction to extend the lookup table with the addresses given to us
  const extendInst = web3.AddressLookupTableProgram.extendLookupTable({
    payer : user.publicKey,
    authority: user.publicKey,
    lookupTable: lookupTableAddress,
    addresses: addresses.slice(0,30),
  });

  //send the transaction with the above two instructions using our custom function
  await sendV0Transaction(
    connection, user,
    [lookupTableInst, extendInst]
  );

  return lookupTableAddress;
}

main()
  .then(() => {
    console.log("Finished successfully")
    process.exit(0)
  })
  .catch((error) => {
    console.log(error)
    process.exit(1)
  })
