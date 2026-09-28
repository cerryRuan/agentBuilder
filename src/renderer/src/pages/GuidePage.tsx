export default function GuidePage(): React.JSX.Element {
  return (
    <div>
      <h1 className="page-title">使用说明</h1>
      <p className="page-desc">
        Agent Builder 用于把内网 Git 仓库的指定分支同步到打包服务器，并可一键触发构建与容器部署。
      </p>

      <div className="card">
        <h3>系统能做什么</h3>
        <ol className="guide-list">
          <li>
            <strong>拉取代码</strong>：在本机用配置的 Git 账号，按仓库/分支拉取最新内容。
          </li>
          <li>
            <strong>上传覆盖</strong>：把源码打包上传到服务器映射目录（不要求远端是 Git 仓库，直接覆盖文件）。
          </li>
          <li>
            <strong>构建部署</strong>（可选）：在服务器执行 <code>build-*.sh</code>，再{' '}
            <code>docker compose build/up</code> 对应业务容器。
          </li>
        </ol>
      </div>

      <div className="card">
        <h3>推荐使用步骤</h3>
        <ol className="guide-steps">
          <li>
            <div className="guide-step-title">1. Git 认证</div>
            <p>
              打开「Git 认证」，填写内网 Git 地址、用户名与 Token/密码。本机拉取分支依赖此项。
            </p>
          </li>
          <li>
            <div className="guide-step-title">2. 添加服务器</div>
            <p>
              「服务器」→ 新增时选择类型：
              <strong>打包服务器</strong>（默认目录 <code>/home/ai_package/deploy</code>）或
              <strong>部署服务器</strong>（默认 <code>/home/deploy</code>）。可用「测连通」确认
              SSH。
            </p>
          </li>
          <li>
            <div className="guide-step-title">3. 添加仓库</div>
            <p>
              「仓库」→ 新增：名称、Git URL、默认分支，并设置<strong>构建角色</strong>：
            </p>
            <ul>
              <li>
                <code>web</code>：前端 → <code>build-frontend</code> + frontend 容器
              </li>
              <li>
                <code>h5</code>：H5 → <code>build-h5</code> + frontend 容器
              </li>
              <li>
                <code>java</code>：Java → <code>build-java</code> + java-backend
              </li>
              <li>
                <code>python</code>：Python → sync/build + python-agent
              </li>
              <li>
                <code>仅上传</code>：只覆盖文件，不构建
              </li>
            </ul>
          </li>
          <li>
            <div className="guide-step-title">4. 配置路径映射</div>
            <p>
              「路径映射」把仓库对应到服务器目录，例如 Web →{' '}
              <code>/home/ai_package/yb-agent-web</code>。
            </p>
          </li>
          <li>
            <div className="guide-step-title">5. 发布（打包机）</div>
            <p>
              「发布」选择<strong>打包服务器</strong>与模式：
            </p>
            <ul>
              <li>
                <strong>仅上传覆盖</strong>：只同步源码
              </li>
              <li>
                <strong>上传并构建部署</strong>：同步后按构建角色执行脚本并重启容器；默认勾选
                <strong>构建部署后打包镜像</strong>，会把本次相关镜像导出到{' '}
                <code>deploy/images/*.tar</code>，再去「服务部署」传到现场机
              </li>
            </ul>
            <p>
              勾选仓库、选择/刷新分支，点击「开始上传并部署」，在下方日志查看进度。
            </p>
          </li>
          <li>
            <div className="guide-step-title">6. 服务部署（现场机）</div>
            <p>
              打包机 <code>deploy/images/*.tar</code> 打好后，打开「服务部署」：选择打包机与部署机，勾选镜像包，工具会：
            </p>
            <ul>
              <li>检查目标部署目录是否具备 compose / scripts / images</li>
              <li>
                <strong>分析目标环境</strong>：读取 <code>COMPOSE_PROFILES</code>、当前 compose
                服务列表、运行中容器，以及 python/java 配置中的中间件地址，判断中间件是本机
                compose 还是外置
              </li>
              <li>把选中 tar <strong>从打包机直传</strong>到目标 <code>images/</code>（或仅执行已有包）</li>
              <li>
                可分开：<strong>仅上传</strong> / <strong>仅执行</strong>（load + 重启）/ <strong>上传并执行</strong>
              </li>
              <li>
                执行 <code>scripts/load-images.sh</code>（<strong>只 load 勾选的 tar</strong>），再只重启<strong>当前环境已激活的业务服务</strong>
                （frontend / java-backend / python-agent），不会启用{' '}
                <code>bundled-infra</code> 去拉起外置中间件
              </li>
            </ul>
          </li>
          <li>
            <div className="guide-step-title">7. 查看结果</div>
            <p>
              「历史」可回看最近任务；线上可访问前端端口（常见 <code>:8090</code>）确认版本。
            </p>
          </li>
        </ol>
      </div>

      <div className="card">
        <h3>各菜单说明</h3>
        <table className="table guide-table">
          <thead>
            <tr>
              <th>菜单</th>
              <th>用途</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>发布</td>
              <td>选打包服务器、勾选仓库与分支，执行上传 / 构建部署</td>
            </tr>
            <tr>
              <td>服务部署</td>
              <td>
                从打包机 images 传 tar 到现场机；勾选 Python 时同步{' '}
                <code>data/python/code</code>
                （现场挂载覆盖镜像内代码）；再 load 并重启已激活业务容器
              </td>
            </tr>
            <tr>
              <td>Git 认证</td>
              <td>本机拉取代码用的 Git Token/密码</td>
            </tr>
            <tr>
              <td>服务器</td>
              <td>管理打包机 / 部署机 SSH 与目录；支持导入导出（不含密码）</td>
            </tr>
            <tr>
              <td>仓库</td>
              <td>管理 Git 仓库与构建角色；支持导入导出</td>
            </tr>
            <tr>
              <td>路径映射</td>
              <td>仓库 → 服务器目录；支持导入导出</td>
            </tr>
            <tr>
              <td>历史</td>
              <td>查看同步/部署任务记录与日志摘要</td>
            </tr>
            <tr>
              <td>系统配置</td>
              <td>主题等全局界面设置</td>
            </tr>
            <tr>
              <td>使用说明</td>
              <td>本页</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="card">
        <h3>注意与常见问题</h3>
        <ul className="guide-list">
          <li>
            上传会排除 <code>.git</code>、<code>node_modules</code>、<code>dist</code>、
            <code>target</code> 等，构建在服务器上重新执行。
          </li>
          <li>
            前端构建需要服务器 Node ≥ 18（建议使用已安装的 Node 22：
            <code>/opt/node-current</code>）。
          </li>
          <li>
            远程路径须为绝对路径且至少两级，避免误覆盖系统目录。
          </li>
          <li>
            「上传并构建部署」时，仓库必须配置正确的构建角色，否则只会上传。
          </li>
          <li>
            构建（尤其 <code>npm install</code> / <code>mvn</code>
            ）可能较久，请看运行日志，不要重复点击。
          </li>
          <li>
            部分现场机中间件为外置（未设置 <code>COMPOSE_PROFILES=bundled-infra</code>
            ）。服务部署会先分析环境：配置指向外部地址或 profile 未启用时按外置处理，部署不会误启本机
            postgres/neo4j/qdrant/minio。
          </li>
          <li>
            Python 现场机通常把 <code>deploy/data/python/code</code> 挂载到容器{' '}
            <code>/app/app</code>。只传镜像不会更新接口代码；服务部署勾选 python / all
            包时会自动从打包机同步该目录。
          </li>
        </ul>
      </div>
    </div>
  )
}
