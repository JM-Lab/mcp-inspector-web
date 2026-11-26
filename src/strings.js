/*
 * Built-in UI text. Pass options.lang to pick one, and options.ui to replace any string.
 * Tab names (Tools, Prompts, Resources, History) and button names stay in English in every language.
 */
export const STRINGS = {
  en: {
    regSearch: 'Search servers', regRecent: 'recently updated · only servers with a remote address', regEmpty: 'No server with a remote address matched.',
    ours: 'Featured servers', mine: 'Servers you added', recent: 'Recently viewed', regMore: 'Show more', addServer: 'Add a server by address', fKnown: 'Well known', fOpen: 'No auth needed', fRecent: 'Recently updated', regKnown: 'well-known servers listed in the registry', openTag: 'No auth', header: 'Header token (optional)', authLabel: 'Authentication (optional)', hName: 'Header name', hValue: 'Header value', pick: 'Choose…', required: 'required', requiredNote: 'fields must be filled in before Run.', missing: 'This field is required.', badNum: 'Enter a number.', examples: 'Examples', authNone: 'No auth', addHint: 'Adding the server takes you to its authorization page, then back here.', oauthBtn: 'Connect with OAuth (PKCE)', remove: 'Remove',
    moreParams: 'More parameters ({v})', more: 'Click to read the full description', asking: 'Asking…', connecting: 'Connecting…',
    empty: 'Nothing here.', historyEmpty: 'No messages yet.', badJson: 'One of the fields is not valid JSON.',
    fail: 'The request failed. Try again later.',
    failCors: 'Could not reach the server from the browser. The server may not allow browser connections (CORS), or the address is wrong.',
    failAuth: 'This server requires authentication. Connect with OAuth, or put its token in the header below.',
    oauthLost: 'Returned from OAuth, but the record of which server started it was not found. Pick the server again and connect with OAuth.',
    failDcr: 'OAuth is not possible here: this server only accepts OAuth clients registered in advance (no dynamic client registration). Put a token issued by the server in the header below.',
    failOauth: 'OAuth could not complete. The server’s OAuth addresses (metadata, registration, token) must allow requests from a browser (CORS). A token in the header still works.',
    token: 'Header token', elicit: 'The server asks for input.',
  },
  ko: {
    regSearch: '서버 검색', regRecent: '최근 고쳐진 서버 · 원격 주소가 있는 서버만', regEmpty: '원격 주소가 있는 서버가 없습니다.',
    ours: '추천 서버', mine: '내가 추가한 서버', recent: '최근에 본 서버', regMore: '더 보기', addServer: '주소로 서버 더하기', fKnown: '잘 알려진 서버', fOpen: '인증 없이 열리는 서버', fRecent: '최근 고쳐진 서버', regKnown: '레지스트리에 등록된 잘 알려진 서버', openTag: '인증 없음', header: '헤더 토큰 (선택)', authLabel: '인증 (선택)', hName: '헤더 이름', hValue: '헤더 값', pick: '고르세요', required: '필수', requiredNote: '칸을 채워야 Run 이 됩니다.', missing: '필수 칸입니다. 값을 넣어 주세요.', badNum: '숫자를 넣어 주세요.', examples: '예시 값 넣기', authNone: '인증 없음', addHint: '더하면 그 서버의 인가 화면으로 넘어갔다가 이 페이지로 돌아옵니다.', oauthBtn: 'OAuth 로 연결 (PKCE)', remove: '빼기',
    moreParams: '값 더 넣기 ({v})', more: '누르면 설명을 전부 봅니다', asking: '묻는 중…', connecting: '연결하는 중…',
    empty: '없습니다.', historyEmpty: '아직 주고받은 메시지가 없습니다.', badJson: 'JSON 칸의 값을 읽을 수 없습니다.',
    fail: '요청이 실패했습니다. 잠시 뒤에 다시 해 주세요.',
    failCors: '브라우저에서 서버에 닿지 못했습니다. 서버가 브라우저 연결(CORS)을 허용하지 않거나 주소가 틀렸을 수 있습니다.',
    failAuth: '인증이 필요한 서버입니다. OAuth 로 연결하거나, 아래 헤더에 토큰을 넣어 주세요.',
    oauthLost: 'OAuth 에서 돌아왔는데 어느 서버에서 시작했는지 기록을 찾지 못했습니다. 서버를 다시 골라 OAuth 로 연결해 주세요.',
    failDcr: '이 서버는 여기서 OAuth 로 연결할 수 없습니다. 미리 등록한 OAuth 클라이언트만 받고 동적 클라이언트 등록을 지원하지 않습니다. 서버에서 발급한 토큰을 아래 헤더에 넣어 주세요.',
    failOauth: 'OAuth 를 마치지 못했습니다. 이 서버의 OAuth 주소들(메타데이터 · 등록 · 토큰)이 브라우저에서 오는 요청(CORS)을 허용해야 합니다. 헤더에 토큰을 넣는 방법은 그대로 됩니다.',
    token: '헤더 토큰', elicit: '서버가 입력을 요청했습니다.',
  },
}
