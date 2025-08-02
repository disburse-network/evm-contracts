import { ethers } from "ethers";

function uint256DecimalToAptosHex(decimalStr) {
  // BigInt from decimal string
  const bn = BigInt(decimalStr);
  // Convert to hex, pad to 64 chars (32 bytes)
  const hex = bn.toString(16).padStart(64, "0");
  return "0x" + hex;
}

// Example usage with the decimal you saw:
const decimalValue = "63000266172231346319512996695871926108063798396739225988256645758492089816215";
console.log(uint256DecimalToAptosHex(decimalValue));
// prints: 0x8b48e313cf5275cf04f33d07245ec6c386f44316a6b2edd1a8ae645f2a349497
