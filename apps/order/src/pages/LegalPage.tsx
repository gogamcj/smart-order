import { Notice } from '@qr/web';
import { useParams } from 'react-router-dom';

/**
 * 약관·개인정보 처리방침 초안. 법률 검토 전 문서이며 운영 전에 정식 문서로 교체해야 한다
 * (서버 terms_documents 의 버전 0.1-draft 와 짝을 이룬다).
 */
const DOCS: Record<string, { title: string; sections: [string, string][] }> = {
  terms: {
    title: '서비스 이용약관 (초안)',
    sections: [
      ['목적', '이 약관은 QR 테이블 주문 서비스(이하 "서비스")를 이용해 매장에서 메뉴를 주문하고 결제하는 데 필요한 사항을 정합니다.'],
      ['주문과 계약', '주문 계약은 고객과 각 매장 사이에 성립합니다. 플랫폼은 주문 접수·결제 대행을 위한 시스템을 제공합니다.'],
      ['결제', '결제는 전자결제대행사를 통해 이루어지며, 결제가 확인된 주문만 매장에 전달됩니다.'],
      ['취소와 환불', '매장이 주문을 거절하거나 취소하면 결제 금액은 결제 수단으로 환불됩니다. 조리가 시작된 뒤의 취소는 매장 정책을 따릅니다.'],
      ['회원 탈퇴', '고객은 언제든 탈퇴할 수 있습니다. 진행 중인 주문이 있으면 주문이 끝난 뒤 탈퇴할 수 있습니다.'],
    ],
  },
  privacy: {
    title: '개인정보 처리방침 (초안)',
    sections: [
      ['수집 항목', '카카오 회원번호, 닉네임(카카오 제공 시), 주문·결제 기록, 접속 기록(IP, 시간). 알림 수신을 선택하면 휴대폰 번호.'],
      ['이용 목적', '주문 접수와 상태 안내, 결제·환불 처리, 부정 이용 방지, 고객 문의 대응.'],
      ['보유 기간', '회원 탈퇴 시 지체 없이 삭제합니다. 다만 전자상거래법 등 법령에 따라 계약·결제 기록은 5년, 접속 기록은 3개월 동안 보관합니다.'],
      ['제3자 제공', '주문 처리를 위해 해당 매장에 주문 내용(메뉴, 테이블, 요청 사항)을 제공합니다. 매장에는 카카오 회원번호를 제공하지 않습니다.'],
      ['처리 위탁', '결제: 전자결제대행사(계약 후 기재). 알림: 카카오 알림톡 발송 대행사(계약 후 기재). 서버: 클라우드 사업자(계약 후 기재).'],
    ],
  },
};

export function LegalPage() {
  const { kind = '' } = useParams();
  const doc = DOCS[kind];
  if (!doc) return <p className="py-10 text-center text-sm text-gray-500">문서를 찾을 수 없습니다.</p>;
  return (
    <article className="space-y-4">
      <h1 className="text-lg font-bold">{doc.title}</h1>
      <Notice tone="warn">법률 검토 전 초안입니다. 정식 서비스 전에 확정된 문서로 바뀝니다.</Notice>
      {doc.sections.map(([h, body], i) => (
        <section key={h}>
          <h2 className="font-semibold">
            제{i + 1}조 {h}
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-gray-700">{body}</p>
        </section>
      ))}
    </article>
  );
}
