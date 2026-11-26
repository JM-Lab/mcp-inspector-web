/*
 * Script tag entry for the add-to-AI-client component alone (dist/mcp-add-to-ai.js).
 * Registers <mcp-add-to-ai>, and exposes window.MCPAddToAI = { addToAiButton, openAddToAi, clientsFor, fromRegistry }.
 *
 *   <script src="mcp-add-to-ai.js"></script>
 *   <mcp-add-to-ai registry="com.microsoft/microsoft-learn-mcp"></mcp-add-to-ai>
 */
import { addToAiButton, openAddToAi, clientsFor, fromRegistry, defineAddToAi } from './add-to-ai.js'

defineAddToAi()
if (typeof window !== 'undefined') window.MCPAddToAI = { addToAiButton, openAddToAi, clientsFor, fromRegistry, defineAddToAi }
