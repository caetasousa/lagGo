// Cria o replica set "rsha" e o usuário administrador (Fase 5, perfil ha).
// Roda DENTRO do mongo-ha1, conectado em localhost: com autenticação ligada e
// nenhum usuário criado, só a "exceção de localhost" permite criar o primeiro.
// Idempotente: numa nova subida, só confere.
const usuario = process.env.MONGO_HA_USUARIO
const senha = process.env.MONGO_HA_SENHA
const admin = db.getSiblingDB('admin')
try { admin.auth(usuario, senha) } catch (e) { /* ainda não existe: exceção de localhost */ }

let iniciado = true
try { rs.status() } catch (e) { iniciado = !/no replset config|NotYetInitialized/i.test(String(e)) }

if (!iniciado) {
  // Começa só com este nó: ele vira primário na hora e o usuário pode ser criado.
  rs.initiate({ _id: 'rsha', members: [{ _id: 0, host: 'mongo-ha1:27017' }] })
  while (!db.hello().isWritablePrimary) sleep(500)
  admin.createUser({ user: usuario, pwd: senha, roles: ['root'] })
  admin.auth(usuario, senha)
  // Agora os outros dois. Votos iguais: a maioria (2 de 3) elege o primário.
  rs.add({ host: 'mongo-ha2:27017' })
  rs.add({ host: 'mongo-ha3:27017' })
  print('rsha criado com 3 membros')
} else {
  print('rsha já existe')
}
for (let i = 0; i < 60 && rs.status().members.filter((m) => ['PRIMARY', 'SECONDARY'].includes(m.stateStr)).length < 3; i++) sleep(1000)
printjson(rs.status().members.map((m) => `${m.name} ${m.stateStr}`))
