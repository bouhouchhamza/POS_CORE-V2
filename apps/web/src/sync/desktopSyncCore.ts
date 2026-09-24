export async function reconcileDesktopCycle(dependencies:{
  cash:()=>Promise<boolean>
  universalMaster:()=>Promise<boolean>
  legacyMaster:()=>Promise<boolean>
  transactional:()=>Promise<boolean>
}){
  await dependencies.cash()
  await dependencies.universalMaster()
  await dependencies.legacyMaster()
  await dependencies.transactional()
}
