/**
 * Permissões que o PixelFinance precisa da Meta — fonte ÚNICA (servidor e tela): o login clássico pede
 * estas (scope), a configuração do Facebook Login for Business precisa tê-las, e o token colado (usuário
 * do sistema) só é aceito se tiver todas. ads_management: necessário p/ act_<id>/activities expor os
 * eventos de cobrança (event_type=ad_account_billing_charge) — a "Atividade de pagamento" do Business Suite.
 * Arquivo sem dependências de servidor: a tela Operações importa daqui.
 */
export const META_PERMISSOES = ["ads_read", "ads_management", "business_management"] as const;
