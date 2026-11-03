-- Cadastro, login e conta (Fase 6, docs/10). Adaptador:
-- internal/loja/adaptadores/postgres/contas.go.

-- name: CriarCliente :one
-- O CPF entra cifrado (pgp_sym_encrypt) e com o HMAC para o UNIQUE. A chave
-- vem da configuração da API como parâmetro — por isso o adaptador desliga o
-- log de consultas lentas nesta transação (o log registraria a chave).
INSERT INTO cliente (nome, email, cpf_cifrado, cpf_hmac, cpf_final)
VALUES (@nome, @email,
        pgp_sym_encrypt(@cpf::text, @chave::text),
        hmac(@cpf::text, 'hmac:' || @chave::text, 'sha256'),
        right(@cpf::text, 2))
RETURNING id;

-- name: CriarEndereco :one
INSERT INTO endereco (cliente_id, cep, logradouro, numero, complemento, cidade, uf)
VALUES (@cliente_id, @cep, @logradouro, @numero, sqlc.narg(complemento), @cidade, @uf)
RETURNING id;

-- name: CriarCredencial :exec
INSERT INTO conta.credencial (cliente_id, senha_hash) VALUES (@cliente_id, @senha_hash);

-- name: CredencialPorEmail :one
-- citext: Ana@X.com e ana@x.com são o mesmo e-mail.
SELECT c.id, cr.senha_hash
  FROM cliente c
  JOIN conta.credencial cr ON cr.cliente_id = c.id
 WHERE c.email = @email AND c.anonimizado_em IS NULL;

-- name: RegistrarAcesso :exec
UPDATE conta.credencial SET ultimo_acesso = now() WHERE cliente_id = @cliente_id;

-- name: ContaPorID :one
-- Lê da visão mascarada: a tela da conta nunca recebe o CPF inteiro (Q6).
SELECT m.id, m.nome, m.email AS email_mascarado, coalesce(m.cpf, '')::text AS cpf_mascarado, c.email,
       e.id AS endereco_id, e.cidade, e.uf
  FROM conta.v_cliente_mascarado m
  JOIN cliente c ON c.id = m.id
  JOIN LATERAL (SELECT id, cidade, uf FROM endereco
                 WHERE cliente_id = m.id AND ativo
                 ORDER BY criado_em DESC LIMIT 1) e ON true
 WHERE m.id = @id AND m.anonimizado_em IS NULL;

-- name: EsquecerCliente :exec
CALL conta.esquecer_cliente(@cliente_id);
